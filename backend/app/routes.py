from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .chat_events import ChatStreamState
from .config import Settings, get_settings
from .db import SessionLocal, get_db_session
from .models import Conversation, Message, ModelCatalog, Workspace
from .schemas import (
    ChatStreamRequest,
    ConversationDetail,
    ConversationSummary,
    ModelCatalogSummary,
    StoredMessage,
    WorkspaceCreateRequest,
    WorkspaceSummary,
)
from .services.chat_service import ChatService
from .sse import format_sse_event, iter_sse


router = APIRouter()
ACTIVE_STREAMS: dict[str, asyncio.Event] = {}
logger = logging.getLogger(__name__)


def get_chat_service(settings: Settings = Depends(get_settings)) -> ChatService:
    return ChatService(settings=settings)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_conversation_id(raw_value: str | int) -> str | None:
    if raw_value in (0, "0", "", None):
        return None
    return str(raw_value)


def _temporary_title(message: str, limit: int) -> str:
    return message.strip().replace("\n", " ")[:limit] or "New chat"


def _serialize_model(model: ModelCatalog) -> ModelCatalogSummary:
    return ModelCatalogSummary(
        model_id=model.model_id,
        label=model.label,
        is_enabled=model.is_enabled,
        is_default_workspace_model=model.is_default_workspace_model,
    )


def _serialize_workspace(workspace: Workspace) -> WorkspaceSummary:
    return WorkspaceSummary(
        workspace_id=workspace.workspace_id,
        name=workspace.name,
        system_message=workspace.system_message,
        selected_model=_serialize_model(workspace.selected_model),
        created_at=workspace.created_at,
        updated_at=workspace.updated_at,
    )


def _serialize_conversation_summary(conversation: Conversation) -> ConversationSummary:
    return ConversationSummary(
        workspace_id=conversation.workspace.workspace_id,
        conversation_id=conversation.conversation_id,
        conversation_title=conversation.conversation_title,
        updated_at=conversation.updated_at,
    )


async def _load_workspace_or_404(session: AsyncSession, public_id: str) -> Workspace:
    result = await session.execute(
        select(Workspace)
        .options(selectinload(Workspace.selected_model))
        .where(Workspace.workspace_id == public_id, Workspace.is_archived.is_(False))
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    return workspace


async def _load_conversation_or_404(session: AsyncSession, public_id: str) -> Conversation:
    result = await session.execute(
        select(Conversation)
        .options(
            selectinload(Conversation.messages),
            selectinload(Conversation.workspace).selectinload(Workspace.selected_model),
        )
        .where(Conversation.conversation_id == public_id)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


async def _load_conversation_messages(conversation_pk: int) -> list[Message]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(Message).where(Message.conversation_fk == conversation_pk).order_by(Message.id.asc())
        )
        return list(result.scalars().all())


async def _load_default_workspace_model(session: AsyncSession) -> ModelCatalog:
    result = await session.execute(
        select(ModelCatalog).where(
            ModelCatalog.is_default_workspace_model.is_(True),
            ModelCatalog.is_enabled.is_(True),
        )
    )
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Default Workspace Model is not configured",
        )
    return model


async def _create_message(
    conversation_pk: int,
    user_query: str,
    openai_response_id: str | None,
) -> Message:
    async with SessionLocal() as session:
        message = Message(
            conversation_fk=conversation_pk,
            query=user_query,
            response="",
            openai_response_id=openai_response_id,
            status="streaming",
        )
        session.add(message)
        conversation = await session.get(Conversation, conversation_pk)
        if conversation is not None:
            conversation.updated_at = _utc_now()
        await session.commit()
        await session.refresh(message)
        return message


async def _update_message_response(message_id: int, response_text: str, status_value: str | None = None) -> None:
    async with SessionLocal() as session:
        message = await session.get(Message, message_id)
        if message is None:
            return
        message.response = response_text
        if status_value is not None:
            message.status = status_value
        message.updated_at = _utc_now()
        conversation = await session.get(Conversation, message.conversation_fk)
        if conversation is not None:
            conversation.updated_at = _utc_now()
        await session.commit()


async def _update_conversation_title(conversation_pk: int, title: str) -> Conversation | None:
    async with SessionLocal() as session:
        conversation = await session.get(Conversation, conversation_pk)
        if conversation is None:
            return None
        conversation.conversation_title = title
        conversation.updated_at = _utc_now()
        await session.commit()
        refreshed = await session.execute(
            select(Conversation)
            .options(selectinload(Conversation.workspace))
            .where(Conversation.id == conversation_pk)
        )
        return refreshed.scalar_one_or_none()


async def _mark_message_error(message_id: int, response_text: str, status_value: str) -> None:
    await _update_message_response(message_id, response_text, status_value)


async def _run_cleanup(awaitable: Any) -> None:
    with suppress(Exception):
        await asyncio.shield(awaitable)


@router.get("/workspaces", response_model=list[WorkspaceSummary])
async def list_workspaces(session: AsyncSession = Depends(get_db_session)) -> list[WorkspaceSummary]:
    result = await session.execute(
        select(Workspace)
        .options(selectinload(Workspace.selected_model))
        .where(Workspace.is_archived.is_(False))
        .order_by(Workspace.sort_order.asc(), Workspace.id.asc())
    )
    return [_serialize_workspace(item) for item in result.scalars().all()]


@router.get("/workspaces/default-model", response_model=ModelCatalogSummary)
async def get_default_workspace_model(session: AsyncSession = Depends(get_db_session)) -> ModelCatalogSummary:
    model = await _load_default_workspace_model(session)
    return _serialize_model(model)


@router.post("/workspaces", response_model=WorkspaceSummary, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    payload: WorkspaceCreateRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> WorkspaceSummary:
    default_model = await _load_default_workspace_model(session)
    next_sort_order = await session.scalar(select(func.coalesce(func.max(Workspace.sort_order) + 1, 0)))
    workspace = Workspace(
        workspace_id=str(uuid4()),
        name=payload.name,
        system_message=settings.chat_system_prompt,
        selected_model_fk=default_model.id,
        sort_order=next_sort_order or 0,
        is_archived=False,
    )
    session.add(workspace)
    await session.commit()

    created_workspace = await _load_workspace_or_404(session, workspace.workspace_id)
    return _serialize_workspace(created_workspace)


@router.get("/workspaces/{workspace_id}/conversations", response_model=list[ConversationSummary])
async def list_workspace_conversations(
    workspace_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> list[ConversationSummary]:
    workspace = await _load_workspace_or_404(session, workspace_id)
    result = await session.execute(
        select(Conversation)
        .options(selectinload(Conversation.workspace))
        .where(Conversation.workspace_fk == workspace.id)
        .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
    )
    return [_serialize_conversation_summary(item) for item in result.scalars().all()]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> ConversationDetail:
    conversation = await _load_conversation_or_404(session, conversation_id)
    return ConversationDetail(
        workspace_id=conversation.workspace.workspace_id,
        conversation_id=conversation.conversation_id,
        conversation_title=conversation.conversation_title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=[
            StoredMessage(
                id=message.id,
                query=message.query,
                response=message.response,
                status=message.status,
                created_at=message.created_at,
                updated_at=message.updated_at,
            )
            for message in conversation.messages
        ],
    )


@router.post("/conversations/{conversation_id}/stop")
async def stop_conversation_stream(conversation_id: str):
    stop_event = ACTIVE_STREAMS.get(conversation_id)
    if stop_event is None:
        logger.info("Stop requested for inactive conversation %s", conversation_id)
        return {"stopped": False}
    stop_event.set()
    logger.info("Stop requested for active conversation %s", conversation_id)
    return {"stopped": True}


@router.post("/chat/stream")
async def stream_chat(
    payload: ChatStreamRequest,
    request: Request,
    chat_service: ChatService = Depends(get_chat_service),
    settings: Settings = Depends(get_settings),
):
    normalized_conversation_id = _normalize_conversation_id(payload.conversation_id)
    conversation_pk: int
    public_conversation_id: str
    workspace_id: str
    temp_title: str | None = None

    async with SessionLocal() as session:
        if normalized_conversation_id is None:
            if not payload.workspace_id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="workspace_id is required for a new Conversation",
                )
            workspace = await _load_workspace_or_404(session, payload.workspace_id)
            public_conversation_id = str(uuid4())
            workspace_id = workspace.workspace_id
            temp_title = _temporary_title(payload.message, settings.title_max_length)
            conversation = Conversation(
                conversation_id=public_conversation_id,
                workspace_fk=workspace.id,
                conversation_title=temp_title,
            )
            session.add(conversation)
            await session.commit()
            await session.refresh(conversation)
        else:
            conversation = await _load_conversation_or_404(session, normalized_conversation_id)
            workspace = conversation.workspace
            public_conversation_id = conversation.conversation_id
            workspace_id = workspace.workspace_id

        if not workspace.selected_model.is_enabled:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Selected Model is disabled for new generation",
            )

        chat_service.configure_runtime(
            system_prompt=workspace.system_message,
            chat_model=workspace.selected_model.model_id,
        )

        conversation_pk = conversation.id

    logger.info(
        "Stream requested for workspace %s conversation %s (new=%s, message_length=%s)",
        workspace_id,
        public_conversation_id,
        normalized_conversation_id is None,
        len(payload.message),
    )

    stop_event = asyncio.Event()
    ACTIVE_STREAMS[public_conversation_id] = stop_event

    async def event_stream():
        title_task: asyncio.Task[str] | None = None
        title_sent = False
        message_id: int | None = None
        response_buffer = ""
        stream: Any | None = None
        terminal_status: str | None = None

        if temp_title is not None:
            yield format_sse_event(
                "conversation.created",
                {
                    "workspace_id": workspace_id,
                    "conversation_id": public_conversation_id,
                    "conversation_title": temp_title,
                },
            )
            title_task = asyncio.create_task(chat_service.generate_title(payload.message))

        messages = await _load_conversation_messages(conversation_pk)

        async def emit_title_if_ready(force: bool = False):
            nonlocal title_sent
            if title_task is None or title_sent:
                return None
            if not force and not title_task.done():
                return None
            title = await title_task
            conversation = await _update_conversation_title(conversation_pk, title)
            title_sent = True
            if conversation is None:
                return None
            return format_sse_event(
                "conversation.title",
                {
                    "workspace_id": conversation.workspace.workspace_id,
                    "conversation_id": conversation.conversation_id,
                    "conversation_title": conversation.conversation_title,
                    "updated_at": conversation.updated_at.isoformat(),
                },
            )

        try:
            stream = chat_service.stream_chat(messages, payload.message)

            async for event in stream:
                if stop_event.is_set():
                    if message_id is not None:
                        await _update_message_response(message_id, response_buffer, "stopped")
                        terminal_status = "stopped"
                    logger.info("Stream stopped by request for conversation %s", public_conversation_id)
                    title_event = await emit_title_if_ready(force=True)
                    if title_event is not None:
                        yield title_event
                    yield format_sse_event(
                        "message.done",
                        {
                            "message_id": message_id,
                            "status": "stopped",
                        },
                    )
                    return
                if await request.is_disconnected():
                    if message_id is not None:
                        await _update_message_response(message_id, response_buffer, "stopped")
                        terminal_status = "stopped"
                    logger.info("Client disconnected during stream for conversation %s", public_conversation_id)
                    return

                title_event = await emit_title_if_ready()
                if title_event is not None:
                    yield title_event

                if event.state == ChatStreamState.STARTED:
                    message = await _create_message(
                        conversation_pk=conversation_pk,
                        user_query=payload.message,
                        openai_response_id=event.response_id,
                    )
                    message_id = message.id
                    logger.info(
                        "Chat stream started for conversation %s with message %s",
                        public_conversation_id,
                        message.id,
                    )
                    yield format_sse_event("message.created", {"message_id": message.id})
                    continue

                if event.state == ChatStreamState.DELTA:
                    if message_id is None:
                        message = await _create_message(
                            conversation_pk=conversation_pk,
                            user_query=payload.message,
                            openai_response_id=event.response_id,
                        )
                        message_id = message.id
                        yield format_sse_event("message.created", {"message_id": message.id})
                    delta = event.delta
                    response_buffer += delta
                    await _update_message_response(message_id, response_buffer)
                    yield format_sse_event("message.delta", {"delta": delta})
                    logger.info(
                        "Chat stream delta for conversation %s now %s chars",
                        public_conversation_id,
                        len(response_buffer),
                    )
                    continue

                if event.state == ChatStreamState.COMPLETED:
                    if message_id is not None:
                        await _update_message_response(message_id, response_buffer, "completed")
                        terminal_status = "completed"
                    logger.info(
                        "Stream completed for conversation %s with message %s and %s chars",
                        public_conversation_id,
                        message_id,
                        len(response_buffer),
                    )
                    title_event = await emit_title_if_ready(force=True)
                    if title_event is not None:
                        yield title_event
                    yield format_sse_event(
                        "message.done",
                        {
                            "message_id": message_id,
                            "status": "completed",
                        },
                    )
                    return

                if event.state == ChatStreamState.ERROR:
                    message_text = event.error_message or "Streaming error"
                    if message_id is not None:
                        await _mark_message_error(message_id, response_buffer, "error")
                        terminal_status = "error"
                    logger.error(
                        "Stream failed for conversation %s: %s",
                        public_conversation_id,
                        message_text,
                    )
                    yield format_sse_event(
                        "error",
                        {
                            "message": message_text,
                            "code": event.error_code or "stream_failed",
                        },
                    )
                    return

            if message_id is not None:
                await _update_message_response(message_id, response_buffer, "completed")
                terminal_status = "completed"
            logger.info(
                "Stream completed for conversation %s with message %s and %s chars",
                public_conversation_id,
                message_id,
                len(response_buffer),
            )
            title_event = await emit_title_if_ready(force=True)
            if title_event is not None:
                yield title_event
            yield format_sse_event(
                "message.done",
                {
                    "message_id": message_id,
                    "status": "completed",
                },
            )
        except asyncio.CancelledError:
            terminal_status = terminal_status or "stopped"
            logger.warning("Stream cancelled for conversation %s", public_conversation_id)
            raise
        except Exception as exc:
            if message_id is not None:
                await _mark_message_error(message_id, response_buffer, "error")
                terminal_status = "error"
            logger.exception("Unhandled stream error for conversation %s: %s", public_conversation_id, exc)
            with suppress(Exception):
                title_event = await emit_title_if_ready(force=True)
                if title_event is not None:
                    yield title_event
            yield format_sse_event("error", {"message": str(exc), "code": "internal_error"})
        finally:
            if message_id is not None and terminal_status is None:
                await _run_cleanup(_update_message_response(message_id, response_buffer, "stopped"))
                logger.info("Stream finalized as stopped for conversation %s", public_conversation_id)
            if title_task is not None and not title_task.done():
                title_task.cancel()
                with suppress(asyncio.CancelledError):
                    await title_task
            if stream is not None:
                await _run_cleanup(chat_service.maybe_close_stream(stream))
            if ACTIVE_STREAMS.get(public_conversation_id) is stop_event:
                ACTIVE_STREAMS.pop(public_conversation_id, None)

    return StreamingResponse(
        iter_sse(event_stream()),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
