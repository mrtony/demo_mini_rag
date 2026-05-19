from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import DATA_DIR, get_settings
from ..models import KnowledgeBaseVersion, KnowledgeDocument, KnowledgeDocumentRevision, Workspace


SUPPORTED_EXTENSIONS = {".txt", ".md", ".markdown", ".pdf"}
UPLOAD_ROOT = DATA_DIR / "knowledge_base_uploads"


@dataclass
class SearchResult:
    knowledge_document_id: str
    display_filename: str
    revision_number: int
    chunk_count: int
    excerpt: str
    score: float
    page_number: int | None = None
    slide_number: int | None = None
    node_id: str | None = None


@dataclass
class NormalizedMarkdownArtifact:
    normalized_markdown_text: str
    page_or_slide_map: list[dict[str, int]]


class KnowledgeBaseIngestionBackend(Protocol):
    def normalize_file(self, native_file_path: str, filename: str) -> NormalizedMarkdownArtifact: ...

    def ingest_revision(
        self,
        *,
        collection_name: str,
        knowledge_document_id: str,
        revision_number: int,
        display_filename: str,
        normalized_markdown_text: str,
        page_or_slide_map: list[dict[str, int]],
        chunk_size: int,
        chunk_overlap: int,
    ) -> int: ...

    def delete_revision(
        self,
        *,
        collection_name: str,
        knowledge_document_id: str,
        revision_number: int,
    ) -> None: ...

    def search(
        self,
        *,
        collection_name: str,
        query: str,
        top_k: int,
        similarity_threshold: float,
    ) -> list[SearchResult]: ...


class LlamaIndexQdrantKnowledgeBaseBackend:
    def __init__(self, *, storage_path: str, embedding_model_name: str) -> None:
        from markitdown import MarkItDown
        from llama_index.core import Document, VectorStoreIndex
        from llama_index.core.ingestion import IngestionPipeline
        from llama_index.core.node_parser import SentenceSplitter
        from llama_index.embeddings.fastembed import FastEmbedEmbedding
        from llama_index.vector_stores.qdrant import QdrantVectorStore
        from qdrant_client import QdrantClient

        self._Document = Document
        self._IngestionPipeline = IngestionPipeline
        self._SentenceSplitter = SentenceSplitter
        self._VectorStoreIndex = VectorStoreIndex
        self._QdrantVectorStore = QdrantVectorStore

        self._storage_path = Path(storage_path)
        self._storage_path.mkdir(parents=True, exist_ok=True)
        self._markitdown = MarkItDown()
        self._embed_model = FastEmbedEmbedding(model_name=embedding_model_name)
        self._qdrant_client = QdrantClient(path=str(self._storage_path))

    def normalize_file(self, native_file_path: str, filename: str) -> NormalizedMarkdownArtifact:
        extension = Path(filename).suffix.lower()
        if extension not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {extension or 'unknown'}")

        if extension in {".txt", ".md", ".markdown"}:
            raw_bytes = Path(native_file_path).read_bytes()
            try:
                raw_bytes.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ValueError("Unable to decode uploaded file as UTF-8 text") from exc

        conversion_result = self._markitdown.convert(native_file_path)
        normalized_markdown = (conversion_result.markdown or conversion_result.text_content or "").strip()
        if not normalized_markdown:
            raise ValueError("Uploaded file did not contain any text")

        locator_map = [] if extension == ".pdf" else [{"page": 1}]
        return NormalizedMarkdownArtifact(
            normalized_markdown_text=normalized_markdown,
            page_or_slide_map=locator_map,
        )

    def ingest_revision(
        self,
        *,
        collection_name: str,
        knowledge_document_id: str,
        revision_number: int,
        display_filename: str,
        normalized_markdown_text: str,
        page_or_slide_map: list[dict[str, int]],
        chunk_size: int,
        chunk_overlap: int,
    ) -> int:
        pipeline = self._IngestionPipeline(
            transformations=[
                self._SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap),
                self._embed_model,
            ]
        )
        document = self._Document(
            text=normalized_markdown_text,
            doc_id=build_revision_ref_doc_id(knowledge_document_id, revision_number),
            metadata={
                "display_filename": display_filename,
                "knowledge_document_id": knowledge_document_id,
                "revision_number": revision_number,
            },
        )
        nodes = pipeline.run(documents=[document])
        if not nodes:
            raise ValueError("Uploaded file did not contain any chunkable text")

        locator_summary = summarize_locators(page_or_slide_map)
        chunk_count = len(nodes)
        for chunk_index, node in enumerate(nodes, start=1):
            node.metadata["display_filename"] = display_filename
            node.metadata["knowledge_document_id"] = knowledge_document_id
            node.metadata["revision_number"] = revision_number
            node.metadata["chunk_count"] = chunk_count
            node.metadata["chunk_index"] = chunk_index
            locator = locator_for_chunk(page_or_slide_map, chunk_index, chunk_count)
            if locator is not None:
                page_number = locator.get("page")
                slide_number = locator.get("slide")
                if isinstance(page_number, int):
                    node.metadata["page_number"] = page_number
                if isinstance(slide_number, int):
                    node.metadata["slide_number"] = slide_number
            if locator_summary:
                node.metadata["locator_summary"] = locator_summary

        self._vector_store(collection_name).add(nodes)
        return chunk_count

    def delete_revision(
        self,
        *,
        collection_name: str,
        knowledge_document_id: str,
        revision_number: int,
    ) -> None:
        if not self._qdrant_client.collection_exists(collection_name):
            return
        self._vector_store(collection_name).delete(
            build_revision_ref_doc_id(knowledge_document_id, revision_number)
        )

    def search(
        self,
        *,
        collection_name: str,
        query: str,
        top_k: int,
        similarity_threshold: float,
    ) -> list[SearchResult]:
        normalized_query = query.strip()
        if not normalized_query:
            return []

        if not self._qdrant_client.collection_exists(collection_name):
            return []

        vector_store = self._vector_store(collection_name)
        index = self._VectorStoreIndex.from_vector_store(
            vector_store=vector_store,
            embed_model=self._embed_model,
        )
        retriever = index.as_retriever(similarity_top_k=max(top_k, 1))
        raw_results = retriever.retrieve(normalized_query)

        best_results_by_document: dict[str, SearchResult] = {}
        for item in raw_results:
            score = float(item.score or 0.0)
            if score < similarity_threshold:
                continue

            metadata = item.node.metadata or {}
            excerpt = item.node.text.strip()[:240]
            knowledge_document_id = str(metadata.get("knowledge_document_id", ""))
            candidate = SearchResult(
                knowledge_document_id=knowledge_document_id,
                display_filename=str(metadata.get("display_filename", "")),
                revision_number=int(metadata.get("revision_number", 0)),
                chunk_count=int(metadata.get("chunk_count", 0)),
                excerpt=excerpt,
                score=score,
                page_number=_int_or_none(metadata.get("page_number")),
                slide_number=_int_or_none(metadata.get("slide_number")),
                node_id=str(getattr(item.node, "node_id", None) or getattr(item.node, "id_", "") or ""),
            )
            existing = best_results_by_document.get(knowledge_document_id)
            if existing is None or candidate.score > existing.score:
                best_results_by_document[knowledge_document_id] = candidate

        return sorted(best_results_by_document.values(), key=lambda entry: entry.score, reverse=True)

    def _vector_store(self, collection_name: str):
        return self._QdrantVectorStore(
            client=self._qdrant_client,
            collection_name=collection_name,
        )


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def compute_content_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def storage_path_for_upload(
    workspace_id: str,
    job_id: str,
    item_id: str,
    filename: str,
) -> Path:
    safe_name = Path(filename).name or "unknown"
    return UPLOAD_ROOT / workspace_id / job_id / item_id / safe_name


def persist_upload_bytes(
    workspace_id: str,
    job_id: str,
    item_id: str,
    filename: str,
    content: bytes,
) -> str:
    path = storage_path_for_upload(workspace_id, job_id, item_id, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return str(path)


def summarize_locators(page_or_slide_map: list[dict[str, int]]) -> list[str]:
    locator_summary: list[str] = []
    for locator in page_or_slide_map:
        page_number = locator.get("page")
        slide_number = locator.get("slide")
        if isinstance(page_number, int):
            locator_summary.append(f"Page {page_number}")
        elif isinstance(slide_number, int):
            locator_summary.append(f"Slide {slide_number}")
    return locator_summary


def locator_for_chunk(
    page_or_slide_map: list[dict[str, int]],
    chunk_index: int,
    chunk_count: int,
) -> dict[str, int] | None:
    if not page_or_slide_map:
        return None
    if len(page_or_slide_map) == 1:
        return page_or_slide_map[0]
    if len(page_or_slide_map) == chunk_count:
        return page_or_slide_map[chunk_index - 1]
    return None


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None


def build_revision_ref_doc_id(knowledge_document_id: str, revision_number: int) -> str:
    return f"{knowledge_document_id}:revision:{revision_number}"


@lru_cache
def get_knowledge_base_backend() -> KnowledgeBaseIngestionBackend:
    settings = get_settings()
    return LlamaIndexQdrantKnowledgeBaseBackend(
        storage_path=settings.kb_qdrant_path,
        embedding_model_name=settings.kb_embedding_model,
    )


def normalize_native_file(native_file_path: str, filename: str) -> NormalizedMarkdownArtifact:
    return get_knowledge_base_backend().normalize_file(native_file_path, filename)


def ingest_document_revision(
    *,
    collection_name: str,
    knowledge_document_id: str,
    revision_number: int,
    display_filename: str,
    normalized_markdown_text: str,
    page_or_slide_map: list[dict[str, int]],
    chunk_size: int,
    chunk_overlap: int,
) -> int:
    return get_knowledge_base_backend().ingest_revision(
        collection_name=collection_name,
        knowledge_document_id=knowledge_document_id,
        revision_number=revision_number,
        display_filename=display_filename,
        normalized_markdown_text=normalized_markdown_text,
        page_or_slide_map=page_or_slide_map,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )


def delete_document_revision_from_index(
    *,
    collection_name: str,
    knowledge_document_id: str,
    revision_number: int,
) -> None:
    get_knowledge_base_backend().delete_revision(
        collection_name=collection_name,
        knowledge_document_id=knowledge_document_id,
        revision_number=revision_number,
    )


def build_version_collection_name(workspace_id: str, version_id: str) -> str:
    normalized_workspace_id = workspace_id.replace("-", "_")
    normalized_version_id = version_id.replace("-", "_")
    return f"workspace_kb_{normalized_workspace_id}_v_{normalized_version_id}"


async def get_next_version_number(
    workspace_fk: int,
    session: AsyncSession,
) -> int:
    result = await session.execute(
        select(func.max(KnowledgeBaseVersion.version_number)).where(
            KnowledgeBaseVersion.workspace_fk == workspace_fk
        )
    )
    current_max = result.scalar_one()
    return 1 if current_max is None else current_max + 1


async def create_knowledge_base_version(
    workspace: Workspace,
    *,
    version_number: int,
    status: str,
    session: AsyncSession,
) -> KnowledgeBaseVersion:
    version_id = str(uuid4())
    version = KnowledgeBaseVersion(
        workspace_fk=workspace.id,
        version_id=version_id,
        version_number=version_number,
        status=status,
        collection_name=build_version_collection_name(workspace.workspace_id, version_id),
    )
    session.add(version)
    await session.flush()
    return version


async def ensure_active_knowledge_base_version(
    workspace: Workspace,
    session: AsyncSession,
) -> KnowledgeBaseVersion:
    if workspace.active_knowledge_base_version is not None:
        return workspace.active_knowledge_base_version

    version = await create_knowledge_base_version(
        workspace,
        version_number=await get_next_version_number(workspace.id, session),
        status="active",
        session=session,
    )
    version.activated_at = utc_now()
    workspace.active_knowledge_base_version_fk = version.id
    await session.flush()
    return version


async def activate_knowledge_base_version(
    workspace: Workspace,
    version: KnowledgeBaseVersion,
    session: AsyncSession,
) -> None:
    current_active = workspace.active_knowledge_base_version
    if current_active is not None and current_active.id != version.id:
        current_active.status = "superseded"
        current_active.superseded_at = utc_now()

    version.status = "active"
    version.activated_at = utc_now()
    workspace.active_knowledge_base_version_fk = version.id
    await session.flush()


async def get_workspace_document_by_filename(
    workspace_fk: int,
    filename: str,
    session: AsyncSession,
) -> KnowledgeDocument | None:
    result = await session.execute(
        select(KnowledgeDocument)
        .where(
            KnowledgeDocument.workspace_fk == workspace_fk,
            KnowledgeDocument.display_filename == filename,
            KnowledgeDocument.is_deleted.is_(False),
        )
        .options(
            selectinload(KnowledgeDocument.current_revision),
            selectinload(KnowledgeDocument.revisions),
        )
    )
    return result.scalar_one_or_none()


async def get_workspace_document_by_hash(
    workspace_fk: int,
    content_hash: str,
    session: AsyncSession,
) -> tuple[KnowledgeDocument, KnowledgeDocumentRevision] | None:
    result = await session.execute(
        select(KnowledgeDocumentRevision)
        .join(KnowledgeDocument, KnowledgeDocumentRevision.knowledge_document_fk == KnowledgeDocument.id)
        .where(
            KnowledgeDocument.workspace_fk == workspace_fk,
            KnowledgeDocument.is_deleted.is_(False),
            KnowledgeDocumentRevision.content_hash == content_hash,
            KnowledgeDocumentRevision.status == "completed",
        )
        .options(selectinload(KnowledgeDocumentRevision.knowledge_document))
        .order_by(KnowledgeDocumentRevision.id.desc())
    )
    revision = result.scalars().first()
    if revision is None:
        return None
    return revision.knowledge_document, revision


async def create_knowledge_document(
    workspace_fk: int,
    filename: str,
    session: AsyncSession,
) -> KnowledgeDocument:
    document = KnowledgeDocument(
        workspace_fk=workspace_fk,
        knowledge_document_id=str(uuid4()),
        display_filename=filename,
    )
    session.add(document)
    await session.flush()
    return document


async def create_completed_revision(
    document: KnowledgeDocument,
    *,
    revision_number: int,
    content_hash: str,
    mime_type: str | None,
    native_file_path: str,
    normalized_markdown_text: str,
    page_or_slide_map: list[dict[str, int]],
    chunk_count: int,
    session: AsyncSession,
) -> KnowledgeDocumentRevision:
    revision = KnowledgeDocumentRevision(
        knowledge_document_fk=document.id,
        revision_number=revision_number,
        content_hash=content_hash,
        mime_type=mime_type,
        native_file_path=native_file_path,
        normalized_markdown_text=normalized_markdown_text,
        page_or_slide_map_json=json.dumps(page_or_slide_map),
        chunk_count=chunk_count,
        status="completed",
    )
    session.add(revision)
    await session.flush()
    document.current_revision_fk = revision.id
    document.updated_at = utc_now()
    await session.flush()
    return revision


async def create_failed_revision(
    document: KnowledgeDocument,
    *,
    revision_number: int,
    content_hash: str,
    mime_type: str | None,
    native_file_path: str,
    error_message: str,
    session: AsyncSession,
) -> KnowledgeDocumentRevision:
    revision = KnowledgeDocumentRevision(
        knowledge_document_fk=document.id,
        revision_number=revision_number,
        content_hash=content_hash,
        mime_type=mime_type,
        native_file_path=native_file_path,
        normalized_markdown_text="",
        page_or_slide_map_json="[]",
        chunk_count=0,
        status="failed",
        error_message=error_message,
    )
    session.add(revision)
    await session.flush()
    return revision


async def get_next_revision_number(
    knowledge_document_fk: int,
    session: AsyncSession,
) -> int:
    result = await session.execute(
        select(func.max(KnowledgeDocumentRevision.revision_number)).where(
            KnowledgeDocumentRevision.knowledge_document_fk == knowledge_document_fk
        )
    )
    current_max = result.scalar_one()
    return 1 if current_max is None else current_max + 1


async def search_workspace_documents(
    workspace_id: str,
    query: str,
    session: AsyncSession,
) -> list[SearchResult]:
    workspace_result = await session.execute(
        select(Workspace)
        .where(Workspace.workspace_id == workspace_id)
        .options(
            selectinload(Workspace.knowledge_base_setting),
            selectinload(Workspace.active_knowledge_base_version),
        )
    )
    workspace = workspace_result.scalar_one_or_none()
    if workspace is None:
        return []

    active_version = workspace.active_knowledge_base_version
    if active_version is None:
        return []

    settings = workspace.knowledge_base_setting
    top_k = settings.retrieval_top_k if settings is not None else 8
    similarity_threshold = settings.similarity_threshold if settings is not None else 0.2
    return get_knowledge_base_backend().search(
        collection_name=active_version.collection_name,
        query=query,
        top_k=top_k,
        similarity_threshold=similarity_threshold,
    )
