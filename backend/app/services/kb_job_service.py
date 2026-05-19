from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import KnowledgeBaseJob, KnowledgeBaseJobItem


_ACTIVE_STATUSES = ("queued", "running")
_HISTORY_STATUSES = ("completed", "failed", "canceled")


async def has_running_job(workspace_fk: int, session: AsyncSession) -> bool:
    result = await session.execute(
        select(KnowledgeBaseJob).where(
            KnowledgeBaseJob.workspace_fk == workspace_fk,
            KnowledgeBaseJob.status == "running",
        )
    )
    return result.scalar_one_or_none() is not None


async def advance_import_queue(
    workspace_id: str,
    session: AsyncSession,
) -> KnowledgeBaseJob | None:
    """Pick the oldest queued job for this workspace (if no running job exists),
    mark it running, process items (stub: mark all imported), then complete it.
    Returns the completed job, or None if there was nothing to advance."""
    from ..models import Workspace

    ws_result = await session.execute(
        select(Workspace).where(Workspace.workspace_id == workspace_id)
    )
    workspace = ws_result.scalar_one_or_none()
    if workspace is None:
        return None

    if await has_running_job(workspace.id, session):
        return None

    result = await session.execute(
        select(KnowledgeBaseJob)
        .where(
            KnowledgeBaseJob.workspace_fk == workspace.id,
            KnowledgeBaseJob.status == "queued",
        )
        .order_by(KnowledgeBaseJob.id.asc())
        .limit(1)
    )
    job = result.scalar_one_or_none()
    if job is None:
        return None

    job.status = "running"
    await session.flush()

    for item in job.items:
        item.status = "imported"
    await session.flush()

    from datetime import datetime, timezone

    job.status = "completed"
    job.completed_at = datetime.now(timezone.utc)
    await session.flush()

    await session.refresh(job)
    return job
