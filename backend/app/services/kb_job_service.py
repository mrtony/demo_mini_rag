from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import KnowledgeBaseJob, KnowledgeDocument, Workspace
from .kb_document_service import (
    activate_knowledge_base_version,
    create_knowledge_base_version,
    create_knowledge_document,
    create_completed_revision,
    create_failed_revision,
    delete_document_revision_from_index,
    ensure_active_knowledge_base_version,
    get_next_revision_number,
    get_next_version_number,
    get_workspace_document_by_hash,
    get_workspace_document_by_filename,
    ingest_document_revision,
    normalize_native_file,
)

logger = logging.getLogger(__name__)
_WORKSPACE_QUEUE_TASKS: dict[str, asyncio.Task[None]] = {}

_ACTIVE_STATUSES = ("queued", "running")


async def has_running_job(workspace_fk: int, session: AsyncSession) -> bool:
    result = await session.execute(
        select(KnowledgeBaseJob).where(
            KnowledgeBaseJob.workspace_fk == workspace_fk,
            KnowledgeBaseJob.status == "running",
        )
    )
    return result.scalar_one_or_none() is not None


async def has_active_rebuild_job(workspace_fk: int, session: AsyncSession) -> bool:
    result = await session.execute(
        select(KnowledgeBaseJob).where(
            KnowledgeBaseJob.workspace_fk == workspace_fk,
            KnowledgeBaseJob.job_type == "rebuild",
            KnowledgeBaseJob.status.in_(_ACTIVE_STATUSES),
        )
    )
    return result.scalar_one_or_none() is not None


async def has_active_import_jobs(workspace_fk: int, session: AsyncSession) -> bool:
    result = await session.execute(
        select(KnowledgeBaseJob).where(
            KnowledgeBaseJob.workspace_fk == workspace_fk,
            KnowledgeBaseJob.job_type == "import",
            KnowledgeBaseJob.status.in_(_ACTIVE_STATUSES),
        )
    )
    return result.scalar_one_or_none() is not None


async def create_rebuild_job(workspace, session: AsyncSession) -> KnowledgeBaseJob:
    target_version = await create_knowledge_base_version(
        workspace,
        version_number=await get_next_version_number(workspace.id, session),
        status="pending",
        session=session,
    )
    result = await session.execute(
        select(KnowledgeDocument).where(
            KnowledgeDocument.workspace_fk == workspace.id,
            KnowledgeDocument.is_deleted.is_(False),
            KnowledgeDocument.current_revision_fk.is_not(None),
        )
    )
    file_count = len(result.scalars().all())
    job = KnowledgeBaseJob(
        job_id=str(uuid4()),
        workspace_fk=workspace.id,
        job_type="rebuild",
        target_version_fk=target_version.id,
        status="queued",
        file_count=file_count,
    )
    session.add(job)
    await session.flush()
    return job


async def _load_workspace_with_kb_relations(workspace_id: str, session: AsyncSession):
    ws_result = await session.execute(
        select(Workspace)
        .where(Workspace.workspace_id == workspace_id)
        .options(
            selectinload(Workspace.knowledge_base_setting),
            selectinload(Workspace.active_knowledge_base_version),
        )
    )
    return ws_result.scalar_one_or_none()


async def _load_next_queued_job(workspace_id: str, session: AsyncSession) -> KnowledgeBaseJob | None:
    workspace = await _load_workspace_with_kb_relations(workspace_id, session)
    if workspace is None:
        return None

    if await has_running_job(workspace.id, session):
        return None

    queued_import_result = await session.execute(
        select(KnowledgeBaseJob)
        .where(
            KnowledgeBaseJob.workspace_fk == workspace.id,
            KnowledgeBaseJob.job_type == "import",
            KnowledgeBaseJob.status == "queued",
        )
        .options(
            selectinload(KnowledgeBaseJob.items),
            selectinload(KnowledgeBaseJob.workspace).selectinload(Workspace.knowledge_base_setting),
            selectinload(KnowledgeBaseJob.workspace).selectinload(Workspace.active_knowledge_base_version),
        )
        .order_by(KnowledgeBaseJob.id.asc())
        .limit(1)
    )
    queued_import = queued_import_result.scalar_one_or_none()
    if queued_import is not None:
        if not await _claim_queued_job(queued_import.id, session):
            return None
        queued_import.status = "running"
        queued_import.started_at = datetime.now(timezone.utc)
        return queued_import

    queued_rebuild_result = await session.execute(
        select(KnowledgeBaseJob)
        .where(
            KnowledgeBaseJob.workspace_fk == workspace.id,
            KnowledgeBaseJob.job_type == "rebuild",
            KnowledgeBaseJob.status == "queued",
        )
        .options(
            selectinload(KnowledgeBaseJob.items),
            selectinload(KnowledgeBaseJob.target_version),
            selectinload(KnowledgeBaseJob.workspace).selectinload(Workspace.knowledge_base_setting),
            selectinload(KnowledgeBaseJob.workspace).selectinload(Workspace.active_knowledge_base_version),
        )
        .order_by(KnowledgeBaseJob.id.asc())
        .limit(1)
    )
    queued_rebuild = queued_rebuild_result.scalar_one_or_none()
    if queued_rebuild is None:
        return None
    if not await _claim_queued_job(queued_rebuild.id, session):
        return None
    queued_rebuild.status = "running"
    queued_rebuild.started_at = datetime.now(timezone.utc)
    return queued_rebuild


async def _claim_queued_job(job_pk: int, session: AsyncSession) -> bool:
    started_at = datetime.now(timezone.utc)
    result = await session.execute(
        update(KnowledgeBaseJob)
        .where(
            KnowledgeBaseJob.id == job_pk,
            KnowledgeBaseJob.status == "queued",
        )
        .values(status="running", started_at=started_at)
    )
    await session.flush()
    return bool(result.rowcount)


async def _process_import_job(job: KnowledgeBaseJob, session: AsyncSession) -> KnowledgeBaseJob:
    workspace = job.workspace
    active_version = await ensure_active_knowledge_base_version(workspace, session)
    await session.flush()

    for item in job.items:
        existing_by_hash = None
        if item.content_hash:
            existing_by_hash = await get_workspace_document_by_hash(workspace.id, item.content_hash, session)

        if existing_by_hash is not None:
            document, revision = existing_by_hash
            item.status = "imported"
            item.outcome = "unchanged"
            item.knowledge_document_fk = document.id
            item.knowledge_document_revision_fk = revision.id
            item.finished_at = datetime.now(timezone.utc)
            continue

        existing_document = await get_workspace_document_by_filename(workspace.id, item.filename, session)
        is_replacement = existing_document is not None and existing_document.current_revision_fk is not None
        try:
            normalized_artifact = normalize_native_file(
                item.native_file_path or "",
                item.filename,
            )
            chunk_size = workspace.knowledge_base_setting.chunk_size if workspace.knowledge_base_setting else 800
            chunk_overlap = workspace.knowledge_base_setting.chunk_overlap if workspace.knowledge_base_setting else 200
            document = existing_document or await create_knowledge_document(workspace.id, item.filename, session)
            revision_number = await get_next_revision_number(document.id, session)
            previous_revision_number = (
                document.current_revision.revision_number
                if document.current_revision is not None
                else None
            )
            chunk_count = ingest_document_revision(
                collection_name=active_version.collection_name,
                knowledge_document_id=document.knowledge_document_id,
                revision_number=revision_number,
                display_filename=document.display_filename,
                normalized_markdown_text=normalized_artifact.normalized_markdown_text,
                page_or_slide_map=normalized_artifact.page_or_slide_map,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )
            revision = await create_completed_revision(
                document,
                revision_number=revision_number,
                content_hash=item.content_hash or "",
                mime_type=item.mime_type,
                native_file_path=item.native_file_path or "",
                normalized_markdown_text=normalized_artifact.normalized_markdown_text,
                page_or_slide_map=normalized_artifact.page_or_slide_map,
                chunk_count=chunk_count,
                session=session,
            )
            if previous_revision_number is not None:
                delete_document_revision_from_index(
                    collection_name=active_version.collection_name,
                    knowledge_document_id=document.knowledge_document_id,
                    revision_number=previous_revision_number,
                )
            item.status = "imported"
            item.outcome = "replaced" if is_replacement else "imported"
            item.knowledge_document_fk = document.id
            item.knowledge_document_revision_fk = revision.id
            item.finished_at = datetime.now(timezone.utc)
        except ValueError as exc:
            error_message = str(exc)
            if error_message.startswith("Unsupported file type"):
                item.status = "unsupported"
                item.outcome = "unsupported"
            else:
                item.status = "failed"
                item.outcome = "failed"
            item.error_message = error_message
            if existing_document is not None:
                revision = await create_failed_revision(
                    existing_document,
                    revision_number=await get_next_revision_number(existing_document.id, session),
                    content_hash=item.content_hash or "",
                    mime_type=item.mime_type,
                    native_file_path=item.native_file_path or "",
                    error_message=error_message,
                    session=session,
                )
                item.knowledge_document_fk = existing_document.id
                item.knowledge_document_revision_fk = revision.id
            item.finished_at = datetime.now(timezone.utc)
    await session.flush()

    if any(item.status in ("failed", "unsupported") for item in job.items):
        job.status = "failed"
        job.error_message = "One or more files failed during import"
    else:
        job.status = "completed"
    job.completed_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(job)
    return job


async def _process_rebuild_job(job: KnowledgeBaseJob, session: AsyncSession) -> KnowledgeBaseJob:
    from ..models import KnowledgeDocument

    workspace = job.workspace
    target_version = job.target_version
    if target_version is None:
        job.status = "failed"
        job.error_message = "Rebuild target version is missing"
        job.completed_at = datetime.now(timezone.utc)
        await session.flush()
        await session.refresh(job)
        return job

    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    target_version.status = "building"
    await session.flush()

    try:
        result = await session.execute(
            select(KnowledgeDocument)
            .where(
                KnowledgeDocument.workspace_fk == workspace.id,
                KnowledgeDocument.is_deleted.is_(False),
                KnowledgeDocument.current_revision_fk.is_not(None),
            )
            .options(selectinload(KnowledgeDocument.current_revision))
            .order_by(KnowledgeDocument.id.asc())
        )
        documents = result.scalars().all()
        chunk_size = workspace.knowledge_base_setting.chunk_size if workspace.knowledge_base_setting else 800
        chunk_overlap = workspace.knowledge_base_setting.chunk_overlap if workspace.knowledge_base_setting else 200

        for document in documents:
            revision = document.current_revision
            if revision is None:
                continue
            ingest_document_revision(
                collection_name=target_version.collection_name,
                knowledge_document_id=document.knowledge_document_id,
                revision_number=revision.revision_number,
                display_filename=document.display_filename,
                normalized_markdown_text=revision.normalized_markdown_text,
                page_or_slide_map=[],
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )

        await activate_knowledge_base_version(workspace, target_version, session)
        if workspace.knowledge_base_setting is not None:
            workspace.knowledge_base_setting.rebuild_required = False
        job.status = "completed"
    except Exception as exc:
        target_version.status = "failed"
        job.status = "failed"
        job.error_message = str(exc)

    job.completed_at = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(job)
    return job


async def advance_import_queue(
    workspace_id: str,
    session: AsyncSession,
) -> KnowledgeBaseJob | None:
    """Advance the next queued knowledge-base job for a workspace."""
    job = await _load_next_queued_job(workspace_id, session)
    if job is None:
        return None

    if job.job_type == "rebuild":
        return await _process_rebuild_job(job, session)
    return await _process_import_job(job, session)


def schedule_import_queue_processing(workspace_id: str) -> None:
    current_task = _WORKSPACE_QUEUE_TASKS.get(workspace_id)
    if current_task is not None and not current_task.done():
        return

    task = asyncio.create_task(
        _process_workspace_queue_until_empty(workspace_id),
        name=f"kb-import-worker:{workspace_id}",
    )
    _WORKSPACE_QUEUE_TASKS[workspace_id] = task

    def _cleanup(completed_task: asyncio.Task[None]) -> None:
        if _WORKSPACE_QUEUE_TASKS.get(workspace_id) is completed_task:
            _WORKSPACE_QUEUE_TASKS.pop(workspace_id, None)
        with contextlib.suppress(asyncio.CancelledError):
            completed_task.result()

    task.add_done_callback(_cleanup)


async def _process_workspace_queue_until_empty(workspace_id: str) -> None:
    from ..db import SessionLocal

    await asyncio.sleep(0.25)
    while True:
        try:
            async with SessionLocal() as session:
                completed_job = await advance_import_queue(workspace_id, session)
                await session.commit()
        except Exception:
            logger.exception("Knowledge base import worker failed for workspace %s", workspace_id)
            return

        if completed_job is None:
            return

        await asyncio.sleep(0)
