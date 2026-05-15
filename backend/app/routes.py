from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .chat_events import ChatStreamState
from .config import Settings, get_settings
from .db import SessionLocal, get_db_session
from .models import Conversation, Message, ModelCatalog, Workspace, WorkspaceModelSetting
from .schemas import (
    ChatStreamRequest,
    ConversationDetail,
    ConversationSummary,
    ModelCatalogEntry,
    ModelCatalogSummary,
    StoredMessage,
    WorkspaceCreateRequest,
    WorkspaceReorderRequest,
    WorkspaceUpdateRequest,
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


def _load_json_object(raw_value: str) -> dict[str, Any]:
    try:
        value = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _serialize_setting_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _deserialize_setting_value(raw_value: str) -> Any:
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError:
        return raw_value


def _model_settings_schema(model: ModelCatalog) -> dict[str, dict[str, Any]]:
    raw_value = _load_json_object(model.settings_schema_json)
    return {key: value for key, value in raw_value.items() if isinstance(value, dict)}


def _model_settings_defaults(model: ModelCatalog) -> dict[str, Any]:
    return _load_json_object(model.settings_defaults_json)


def _serialize_model(model: ModelCatalog) -> ModelCatalogSummary:
    return ModelCatalogSummary(
        model_id=model.model_id,
        label=model.label,
        is_enabled=model.is_enabled,
        is_default_workspace_model=model.is_default_workspace_model,
    )


def _serialize_model_entry(model: ModelCatalog) -> ModelCatalogEntry:
    return ModelCatalogEntry(
        model_id=model.model_id,
        label=model.label,
        is_enabled=model.is_enabled,
        is_default_workspace_model=model.is_default_workspace_model,
        supports_system_message=model.supports_system_message,
        settings_schema=_model_settings_schema(model),
        settings_defaults=_model_settings_defaults(model),
        sort_order=model.sort_order,
    )


def _workspace_model_settings_map(workspace: Workspace) -> dict[str, Any]:
    return {
        item.setting_key: _deserialize_setting_value(item.setting_value_json)
        for item in workspace.model_settings
    }


def _serialize_workspace(workspace: Workspace) -> WorkspaceSummary:
    return WorkspaceSummary(
        workspace_id=workspace.workspace_id,
        name=workspace.name,
        system_message=workspace.system_message,
        selected_model=_serialize_model(workspace.selected_model),
        model_settings=_workspace_model_settings_map(workspace),
        sort_order=workspace.sort_order,
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
    return await _load_workspace_by_public_id_or_404(session, public_id, include_archived=False)


async def _load_workspace_by_public_id_or_404(
    session: AsyncSession,
    public_id: str,
    *,
    include_archived: bool,
) -> Workspace:
    conditions = [Workspace.workspace_id == public_id]
    if not include_archived:
        conditions.append(Workspace.is_archived.is_(False))

    result = await session.execute(
        select(Workspace)
        .options(
            selectinload(Workspace.selected_model),
            selectinload(Workspace.model_settings),
        )
        .execution_options(populate_existing=True)
        .where(*conditions)
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
            selectinload(Conversation.workspace).selectinload(Workspace.model_settings),
        )
        .execution_options(populate_existing=True)
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


async def _load_enabled_model_or_422(session: AsyncSession, model_id: str) -> ModelCatalog:
    result = await session.execute(select(ModelCatalog).where(ModelCatalog.model_id == model_id))
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Selected Model does not exist in the Model Catalog",
        )
    if not model.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Selected Model must be enabled before saving Workspace Settings",
        )
    return model


def _coerce_model_setting_value(setting_key: str, schema: dict[str, Any], value: Any) -> Any:
    setting_type = schema.get("type")

    if setting_type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{setting_key} must be a number",
            )
        numeric_value = float(value)
        min_value = schema.get("min")
        max_value = schema.get("max")
        if isinstance(min_value, (int, float)) and numeric_value < float(min_value):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{setting_key} must be greater than or equal to {min_value}",
            )
        if isinstance(max_value, (int, float)) and numeric_value > float(max_value):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{setting_key} must be less than or equal to {max_value}",
            )
        return numeric_value

    if setting_type == "enum":
        if not isinstance(value, str):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{setting_key} must be a string",
            )
        options = schema.get("options", [])
        allowed_values = {
            option.get("value")
            for option in options
            if isinstance(option, dict) and isinstance(option.get("value"), str)
        }
        if value not in allowed_values:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{setting_key} is not supported by the Selected Model",
            )
        return value

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=f"{setting_key} uses an unsupported schema type",
    )


def _validated_model_settings(model: ModelCatalog, payload_settings: dict[str, Any]) -> dict[str, Any]:
    schema = _model_settings_schema(model)
    defaults = _model_settings_defaults(model)
    applicable_settings = defaults | {
        key: value for key, value in payload_settings.items() if key in schema
    }
    return {
        key: _coerce_model_setting_value(key, schema[key], value)
        for key, value in applicable_settings.items()
    }


async def _replace_workspace_model_settings(
    session: AsyncSession,
    workspace: Workspace,
    model_settings: dict[str, Any],
) -> None:
    await session.execute(
        delete(WorkspaceModelSetting).where(WorkspaceModelSetting.workspace_fk == workspace.id)
    )

    for setting_key, setting_value in model_settings.items():
        session.add(
            WorkspaceModelSetting(
                workspace_fk=workspace.id,
                setting_key=setting_key,
                setting_value_json=_serialize_setting_value(setting_value),
            )
        )


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
        .options(
            selectinload(Workspace.selected_model),
            selectinload(Workspace.model_settings),
        )
        .where(Workspace.is_archived.is_(False))
        .order_by(Workspace.sort_order.asc(), Workspace.id.asc())
    )
    return [_serialize_workspace(item) for item in result.scalars().all()]


@router.get("/workspaces/archived", response_model=list[WorkspaceSummary])
async def list_archived_workspaces(
    session: AsyncSession = Depends(get_db_session),
) -> list[WorkspaceSummary]:
    result = await session.execute(
        select(Workspace)
        .options(
            selectinload(Workspace.selected_model),
            selectinload(Workspace.model_settings),
        )
        .where(Workspace.is_archived.is_(True))
        .order_by(Workspace.sort_order.asc(), Workspace.id.asc())
    )
    return [_serialize_workspace(item) for item in result.scalars().all()]


@router.get("/workspaces/default-model", response_model=ModelCatalogSummary)
async def get_default_workspace_model(session: AsyncSession = Depends(get_db_session)) -> ModelCatalogSummary:
    model = await _load_default_workspace_model(session)
    return _serialize_model(model)


@router.get("/models", response_model=list[ModelCatalogEntry])
async def list_models(session: AsyncSession = Depends(get_db_session)) -> list[ModelCatalogEntry]:
    result = await session.execute(
        select(ModelCatalog)
        .where(ModelCatalog.is_enabled.is_(True))
        .order_by(ModelCatalog.sort_order.asc(), ModelCatalog.id.asc())
    )
    return [_serialize_model_entry(item) for item in result.scalars().all()]


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
    await session.flush()
    await _replace_workspace_model_settings(session, workspace, _model_settings_defaults(default_model))
    await session.commit()

    created_workspace = await _load_workspace_or_404(session, workspace.workspace_id)
    return _serialize_workspace(created_workspace)


@router.put("/workspaces/{workspace_id}", response_model=WorkspaceSummary)
async def update_workspace(
    workspace_id: str,
    payload: WorkspaceUpdateRequest,
    session: AsyncSession = Depends(get_db_session),
) -> WorkspaceSummary:
    workspace = await _load_workspace_or_404(session, workspace_id)
    selected_model = await _load_enabled_model_or_422(session, payload.selected_model_id)
    model_settings = _validated_model_settings(selected_model, payload.model_settings)
    workspace.name = payload.name
    workspace.system_message = payload.system_message
    workspace.selected_model_fk = selected_model.id
    workspace.updated_at = _utc_now()
    await _replace_workspace_model_settings(session, workspace, model_settings)
    await session.commit()

    updated_workspace = await _load_workspace_or_404(session, workspace_id)
    return _serialize_workspace(updated_workspace)


@router.post("/workspaces/reorder", response_model=list[WorkspaceSummary])
async def reorder_workspaces(
    payload: WorkspaceReorderRequest,
    session: AsyncSession = Depends(get_db_session),
) -> list[WorkspaceSummary]:
    result = await session.execute(
        select(Workspace)
        .options(
            selectinload(Workspace.selected_model),
            selectinload(Workspace.model_settings),
        )
        .where(Workspace.is_archived.is_(False))
    )
    active_workspaces = list(result.scalars().all())
    workspaces_by_public_id = {workspace.workspace_id: workspace for workspace in active_workspaces}
    provided_ids = payload.workspace_ids

    if len(provided_ids) != len(active_workspaces) or set(provided_ids) != set(workspaces_by_public_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="workspace_ids must include each active Workspace exactly once",
        )

    for sort_order, workspace_id in enumerate(provided_ids):
        workspace = workspaces_by_public_id[workspace_id]
        workspace.sort_order = sort_order
        workspace.updated_at = _utc_now()

    await session.commit()

    refreshed_result = await session.execute(
        select(Workspace)
        .options(
            selectinload(Workspace.selected_model),
            selectinload(Workspace.model_settings),
        )
        .where(Workspace.is_archived.is_(False))
        .order_by(Workspace.sort_order.asc(), Workspace.id.asc())
    )
    return [_serialize_workspace(item) for item in refreshed_result.scalars().all()]


@router.post("/workspaces/{workspace_id}/archive", response_model=WorkspaceSummary)
async def archive_workspace(
    workspace_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> WorkspaceSummary:
    workspace = await _load_workspace_or_404(session, workspace_id)
    workspace.is_archived = True
    workspace.updated_at = _utc_now()
    await session.commit()

    archived_workspace = await _load_workspace_by_public_id_or_404(
        session,
        workspace_id,
        include_archived=True,
    )
    return _serialize_workspace(archived_workspace)


@router.post("/workspaces/{workspace_id}/restore", response_model=WorkspaceSummary)
async def restore_workspace(
    workspace_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> WorkspaceSummary:
    workspace = await _load_workspace_by_public_id_or_404(session, workspace_id, include_archived=True)
    workspace.is_archived = False
    workspace.updated_at = _utc_now()
    await session.commit()

    restored_workspace = await _load_workspace_or_404(session, workspace_id)
    return _serialize_workspace(restored_workspace)


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
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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
            model_settings=_workspace_model_settings_map(workspace),
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
