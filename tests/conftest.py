import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
import re
import sys

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.chat_events import ChatEvent, ChatStreamState
from backend.app.db import Base
from backend.app.main import app
from backend.app.routes import get_chat_service
from backend.app.services.kb_document_service import NormalizedMarkdownArtifact, SearchResult


class FakeKnowledgeBaseBackend:
    def __init__(self) -> None:
        self.collections: dict[str, dict[tuple[str, int], SearchResult]] = {}

    def normalize_file(self, native_file_path: str, filename: str) -> NormalizedMarkdownArtifact:
        extension = Path(filename).suffix.lower()
        if extension not in {".txt", ".md", ".markdown", ".pdf"}:
            raise ValueError(f"Unsupported file type: {extension or 'unknown'}")

        raw_bytes = Path(native_file_path).read_bytes()
        if extension in {".txt", ".md", ".markdown"}:
            try:
                normalized_markdown = raw_bytes.decode("utf-8").strip()
            except UnicodeDecodeError as exc:
                raise ValueError("Unable to decode uploaded file as UTF-8 text") from exc
        else:
            decoded_pdf = raw_bytes.decode("latin-1", errors="ignore")
            normalized_markdown = "Hello PDF" if "Hello PDF" in decoded_pdf else decoded_pdf.strip()

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
        words = re.findall(r"\S+", normalized_markdown_text)
        chunk_count = max(1, (len(words) + max(chunk_size, 1) - 1) // max(chunk_size, 1))
        locator = page_or_slide_map[0] if page_or_slide_map else {}
        self.collections.setdefault(collection_name, {})[(knowledge_document_id, revision_number)] = SearchResult(
            knowledge_document_id=knowledge_document_id,
            display_filename=display_filename,
            revision_number=revision_number,
            chunk_count=chunk_count,
            excerpt=normalized_markdown_text[:240],
            score=1.0,
            page_number=locator.get("page"),
            slide_number=locator.get("slide"),
            node_id=f"{knowledge_document_id}:revision:{revision_number}",
        )
        return chunk_count

    def delete_revision(
        self,
        *,
        collection_name: str,
        knowledge_document_id: str,
        revision_number: int,
    ) -> None:
        self.collections.get(collection_name, {}).pop((knowledge_document_id, revision_number), None)

    def search(
        self,
        *,
        collection_name: str,
        query: str,
        top_k: int,
        similarity_threshold: float,
    ) -> list[SearchResult]:
        if not query.strip():
            return []
        results = list(self.collections.get(collection_name, {}).values())
        return results[: max(top_k, 1)]


class FakeChatService:
    def __init__(self) -> None:
        self.closed = False
        self.title = "Test title"
        self.system_prompt = None
        self.chat_model = None

    def configure_runtime(
        self,
        *,
        system_prompt: str,
        chat_model: str,
        model_settings: dict[str, object],
    ) -> None:
        self.system_prompt = system_prompt
        self.chat_model = chat_model
        self.model_settings = model_settings

    async def stream_chat(self, messages, user_message):
        yield ChatEvent(state=ChatStreamState.STARTED, response_id="resp_test_1")
        await asyncio.sleep(0)
        yield ChatEvent(state=ChatStreamState.DELTA, delta="Hello", response_id="resp_test_1")
        await asyncio.sleep(0)
        yield ChatEvent(state=ChatStreamState.DELTA, delta=" world", response_id="resp_test_1")
        await asyncio.sleep(0)
        yield ChatEvent(state=ChatStreamState.COMPLETED)

    async def stream_prompt_messages(self, prompt_messages, *, prompt_length: int, history_size: int):
        async for event in self.stream_chat([], ""):
            yield event

    async def generate_title(self, first_message: str) -> str:
        return self.title

    async def maybe_close_stream(self, stream) -> None:
        self.closed = True


@pytest_asyncio.fixture()
async def test_client(tmp_path, monkeypatch) -> AsyncIterator[AsyncClient]:
    from backend.app import db as db_module
    from backend.app import routes as routes_module
    from backend.app.services import kb_document_service
    from backend.app.services.catalog_service import seed_model_catalog

    database_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)

    db_module.engine = engine
    db_module.SessionLocal = session_local
    routes_module.SessionLocal = session_local

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    await seed_model_catalog()

    app.dependency_overrides[get_chat_service] = FakeChatService
    fake_knowledge_base_backend = FakeKnowledgeBaseBackend()
    kb_document_service.get_knowledge_base_backend.cache_clear()
    monkeypatch.setattr(
        kb_document_service,
        "get_knowledge_base_backend",
        lambda: fake_knowledge_base_backend,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()
    await engine.dispose()
