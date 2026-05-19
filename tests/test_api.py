import asyncio
import json

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from backend.app.chat_events import ChatEvent, ChatStreamState
from backend.app import db as db_module
from backend.app.config import get_settings
from backend.app.main import app
from backend.app.models import (
    KnowledgeBaseVersion,
    ModelCatalog,
    Workspace,
    WorkspaceKnowledgeBaseSetting,
    WorkspaceModelSetting,
)
from backend.app.routes import get_chat_service
from backend.app.services.kb_document_service import SearchResult


def parse_sse_payload(raw_text: str) -> list[tuple[str, dict]]:
    chunks = [chunk for chunk in raw_text.split("\n\n") if chunk.strip()]
    events: list[tuple[str, dict]] = []
    for chunk in chunks:
        lines = chunk.splitlines()
        event_name = ""
        data_payload = ""
        for line in lines:
            if line.startswith("event: "):
                event_name = line.removeprefix("event: ")
            if line.startswith("data: "):
                data_payload = line.removeprefix("data: ")
        if event_name:
            events.append((event_name, json.loads(data_payload)))
    return events


async def create_workspace(test_client, name: str = "Workspace Alpha") -> dict:
    response = await test_client.post("/api/workspaces", json={"name": name})
    assert response.status_code == 201
    return response.json()


def expected_model_settings(model_id: str) -> dict:
    if model_id == "gpt-5.4-nano":
        return {"temperature": 0.7}
    return {
        "temperature": 1.0,
        "reasoning_effort": "medium",
    }


@pytest.mark.asyncio
async def test_reads_default_workspace_model_for_create_flow(test_client):
    settings = get_settings()

    response = await test_client.get("/api/workspaces/default-model")

    assert response.status_code == 200
    payload = response.json()
    assert payload["model_id"] == settings.chat_model
    assert payload["label"].strip()
    assert payload["is_enabled"] is True
    assert payload["is_default_workspace_model"] is True


@pytest.mark.asyncio
async def test_lists_enabled_model_catalog_entries_with_dynamic_settings_metadata(test_client):
    settings = get_settings()
    response = await test_client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    model_ids = [item["model_id"] for item in payload]
    assert settings.chat_model in model_ids
    assert "gpt-5.4-nano" in model_ids
    assert all(item["is_enabled"] is True for item in payload)
    assert "gpt-4.1-classic" not in model_ids

    default_model = next(item for item in payload if item["model_id"] == settings.chat_model)
    assert default_model["settings_defaults"] == expected_model_settings(settings.chat_model)
    assert default_model["settings_schema"]["temperature"]["type"] == "number"
    if settings.chat_model == "gpt-5.4-mini":
        assert default_model["settings_schema"]["reasoning_effort"]["type"] == "enum"


@pytest.mark.asyncio
async def test_creates_workspace_with_default_settings_and_rejects_invalid_names(test_client):
    settings = get_settings()
    response = await test_client.post("/api/workspaces", json={"name": "Workspace Alpha"})

    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "Workspace Alpha"
    assert payload["workspace_id"]
    assert payload["system_message"].strip()
    assert payload["selected_model"]["model_id"] == settings.chat_model
    assert payload["selected_model"]["is_enabled"] is True
    assert payload["selected_model"]["is_default_workspace_model"] is True
    assert payload["model_settings"] == expected_model_settings(settings.chat_model)

    short_name_response = await test_client.post("/api/workspaces", json={"name": "ab"})
    blank_name_response = await test_client.post("/api/workspaces", json={"name": "   "})

    assert short_name_response.status_code == 422
    assert blank_name_response.status_code == 422


@pytest.mark.asyncio
async def test_archives_and_restores_workspaces_between_active_and_archived_lists(test_client):
    workspace_alpha = await create_workspace(test_client, "Workspace Alpha")
    workspace_beta = await create_workspace(test_client, "Workspace Beta")

    archive_response = await test_client.post(f"/api/workspaces/{workspace_alpha['workspace_id']}/archive")

    assert archive_response.status_code == 200
    archived_workspace = archive_response.json()
    assert archived_workspace["workspace_id"] == workspace_alpha["workspace_id"]
    assert archived_workspace["name"] == "Workspace Alpha"

    active_list_response = await test_client.get("/api/workspaces")
    archived_list_response = await test_client.get("/api/workspaces/archived")
    archived_conversations_response = await test_client.get(
        f"/api/workspaces/{workspace_alpha['workspace_id']}/conversations"
    )

    assert active_list_response.status_code == 200
    assert [item["workspace_id"] for item in active_list_response.json()] == [workspace_beta["workspace_id"]]
    assert archived_list_response.status_code == 200
    assert [item["workspace_id"] for item in archived_list_response.json()] == [workspace_alpha["workspace_id"]]
    assert archived_conversations_response.status_code == 404

    restore_response = await test_client.post(f"/api/workspaces/{workspace_alpha['workspace_id']}/restore")

    assert restore_response.status_code == 200
    restored_workspace = restore_response.json()
    assert restored_workspace["workspace_id"] == workspace_alpha["workspace_id"]

    restored_active_list_response = await test_client.get("/api/workspaces")
    restored_archived_list_response = await test_client.get("/api/workspaces/archived")

    assert restored_active_list_response.status_code == 200
    assert [item["workspace_id"] for item in restored_active_list_response.json()] == [
        workspace_alpha["workspace_id"],
        workspace_beta["workspace_id"],
    ]
    assert restored_archived_list_response.status_code == 200
    assert restored_archived_list_response.json() == []


@pytest.mark.asyncio
async def test_reorders_active_workspaces_and_persists_manual_order(test_client):
    workspace_alpha = await create_workspace(test_client, "Workspace Alpha")
    workspace_beta = await create_workspace(test_client, "Workspace Beta")
    workspace_gamma = await create_workspace(test_client, "Workspace Gamma")

    reorder_response = await test_client.post(
        "/api/workspaces/reorder",
        json={
            "workspace_ids": [
                workspace_gamma["workspace_id"],
                workspace_alpha["workspace_id"],
                workspace_beta["workspace_id"],
            ]
        },
    )

    assert reorder_response.status_code == 200
    assert [item["workspace_id"] for item in reorder_response.json()] == [
        workspace_gamma["workspace_id"],
        workspace_alpha["workspace_id"],
        workspace_beta["workspace_id"],
    ]

    active_list_response = await test_client.get("/api/workspaces")

    assert active_list_response.status_code == 200
    assert [item["workspace_id"] for item in active_list_response.json()] == [
        workspace_gamma["workspace_id"],
        workspace_alpha["workspace_id"],
        workspace_beta["workspace_id"],
    ]

    async with db_module.SessionLocal() as session:
        result = await session.execute(
            select(Workspace.workspace_id, Workspace.sort_order).order_by(Workspace.sort_order.asc())
        )
        stored_order = result.all()

    assert stored_order == [
        (workspace_gamma["workspace_id"], 0),
        (workspace_alpha["workspace_id"], 1),
        (workspace_beta["workspace_id"], 2),
    ]


@pytest.mark.asyncio
async def test_updates_workspace_settings_with_model_validation_and_obsolete_cleanup(test_client):
    workspace = await create_workspace(test_client, "Workspace Alpha")

    update_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}",
        json={
            "name": "Workspace Renamed",
            "system_message": "You are a focused assistant.",
            "selected_model_id": "gpt-5.4-mini",
            "model_settings": {
                "temperature": 1.4,
                "reasoning_effort": "high",
                "unsupported_field": "drop me",
            },
        },
    )

    assert update_response.status_code == 200
    payload = update_response.json()
    assert payload["workspace_id"] == workspace["workspace_id"]
    assert payload["name"] == "Workspace Renamed"
    assert payload["system_message"] == "You are a focused assistant."
    assert payload["selected_model"]["model_id"] == "gpt-5.4-mini"
    assert payload["model_settings"] == {
        "temperature": 1.4,
        "reasoning_effort": "high",
    }

    second_update_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}",
        json={
            "name": "Workspace Renamed",
            "system_message": "You are a focused assistant.",
            "selected_model_id": "gpt-5.4-nano",
            "model_settings": {
                "temperature": 0.4,
                "reasoning_effort": "minimal",
            },
        },
    )
    assert second_update_response.status_code == 200
    assert second_update_response.json()["model_settings"] == {
        "temperature": 0.4,
    }

    async with db_module.SessionLocal() as session:
        result = await session.execute(
            select(WorkspaceModelSetting.setting_key, WorkspaceModelSetting.setting_value_json).order_by(
                WorkspaceModelSetting.setting_key.asc()
            )
        )
        stored_settings = result.all()

    assert stored_settings == [("temperature", "0.4")]

    short_name_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}",
        json={
            "name": "ab",
            "system_message": "Still valid",
            "selected_model_id": "gpt-5.4-mini",
            "model_settings": {
                "temperature": 1.0,
                "reasoning_effort": "medium",
            },
        },
    )
    blank_system_message_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}",
        json={
            "name": "Workspace Valid",
            "system_message": "   ",
            "selected_model_id": "gpt-5.4-mini",
            "model_settings": {
                "temperature": 1.0,
                "reasoning_effort": "medium",
            },
        },
    )
    invalid_model_setting_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}",
        json={
            "name": "Workspace Valid",
            "system_message": "Still valid",
            "selected_model_id": "gpt-5.4-mini",
            "model_settings": {
                "temperature": 4,
                "reasoning_effort": "medium",
            },
        },
    )
    disabled_model_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}",
        json={
            "name": "Workspace Valid",
            "system_message": "Still valid",
            "selected_model_id": "gpt-4.1-classic",
            "model_settings": {
                "temperature": 1.0,
            },
        },
    )

    assert short_name_response.status_code == 422
    assert blank_system_message_response.status_code == 422
    assert invalid_model_setting_response.status_code == 422
    assert disabled_model_response.status_code == 422


@pytest.mark.asyncio
async def test_workspace_owns_default_knowledge_base_settings(test_client):
    workspace = await create_workspace(test_client, "Workspace KB")

    response = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base-settings"
    )

    assert response.status_code == 200
    assert response.json() == {
        "workspace_id": workspace["workspace_id"],
        "chunk_size": 800,
        "chunk_overlap": 200,
        "retrieval_top_k": 8,
        "similarity_threshold": 0.2,
        "knowledge_answering_default": False,
        "rebuild_required": False,
    }

    async with db_module.SessionLocal() as session:
        result = await session.execute(
            select(WorkspaceKnowledgeBaseSetting).join(Workspace).where(
                Workspace.workspace_id == workspace["workspace_id"]
            )
        )
        stored_settings = result.scalar_one()

    assert stored_settings.chunk_size == 800
    assert stored_settings.chunk_overlap == 200
    assert stored_settings.retrieval_top_k == 8
    assert stored_settings.similarity_threshold == 0.2
    assert stored_settings.knowledge_answering_default is False
    assert stored_settings.rebuild_required is False


@pytest.mark.asyncio
async def test_updates_knowledge_base_settings_and_only_ingestion_changes_require_rebuild(test_client):
    workspace = await create_workspace(test_client, "Workspace KB")

    retrieval_only_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base-settings",
        json={
            "chunk_size": 800,
            "chunk_overlap": 200,
            "retrieval_top_k": 12,
            "similarity_threshold": 0.35,
            "knowledge_answering_default": True,
        },
    )

    assert retrieval_only_response.status_code == 200
    assert retrieval_only_response.json() == {
        "workspace_id": workspace["workspace_id"],
        "chunk_size": 800,
        "chunk_overlap": 200,
        "retrieval_top_k": 12,
        "similarity_threshold": 0.35,
        "knowledge_answering_default": True,
        "rebuild_required": False,
    }

    ingestion_change_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base-settings",
        json={
            "chunk_size": 1000,
            "chunk_overlap": 250,
            "retrieval_top_k": 12,
            "similarity_threshold": 0.35,
            "knowledge_answering_default": True,
        },
    )

    assert ingestion_change_response.status_code == 200
    assert ingestion_change_response.json() == {
        "workspace_id": workspace["workspace_id"],
        "chunk_size": 1000,
        "chunk_overlap": 250,
        "retrieval_top_k": 12,
        "similarity_threshold": 0.35,
        "knowledge_answering_default": True,
        "rebuild_required": True,
    }


@pytest.mark.asyncio
async def test_next_turn_uses_only_latest_saved_workspace_settings(test_client):
    workspace = await create_workspace(test_client, "Workspace Settings")

    class RecordingChatService:
        configure_calls: list[dict[str, str]] = []

        def configure_runtime(
            self,
            *,
            system_prompt: str,
            chat_model: str,
            model_settings: dict[str, object],
        ) -> None:
            self.__class__.configure_calls.append(
                {
                    "system_prompt": system_prompt,
                    "chat_model": chat_model,
                    "model_settings": model_settings,
                }
            )

        async def stream_chat(self, messages, user_message):
            yield ChatEvent(state=ChatStreamState.STARTED, response_id="resp_recording_1")
            yield ChatEvent(state=ChatStreamState.DELTA, delta="Hello", response_id="resp_recording_1")
            yield ChatEvent(state=ChatStreamState.COMPLETED)

        async def generate_title(self, first_message: str) -> str:
            return "Recorded title"

        async def maybe_close_stream(self, stream) -> None:
            return None

    app.dependency_overrides[get_chat_service] = RecordingChatService
    RecordingChatService.configure_calls = []

    try:
        first_response = await test_client.post(
            "/api/chat/stream",
            json={
                "workspace_id": workspace["workspace_id"],
                "conversation_id": 0,
                "message_id": 0,
                "message": "第一句",
            },
        )

        first_events = parse_sse_payload(first_response.text)
        conversation_id = first_events[0][1]["conversation_id"]

        update_response = await test_client.put(
            f"/api/workspaces/{workspace['workspace_id']}",
            json={
                "name": "Workspace Settings",
                "system_message": "Only saved settings should apply.",
                "selected_model_id": "gpt-5.4-mini",
                "model_settings": {
                    "temperature": 1.6,
                    "reasoning_effort": "high",
                },
            },
        )
        assert update_response.status_code == 200

        second_response = await test_client.post(
            "/api/chat/stream",
            json={
                "workspace_id": workspace["workspace_id"],
                "conversation_id": conversation_id,
                "message_id": 0,
                "message": "第二句",
            },
        )

        assert second_response.status_code == 200
        assert RecordingChatService.configure_calls == [
            {
                "system_prompt": workspace["system_message"],
                "chat_model": workspace["selected_model"]["model_id"],
                "model_settings": workspace["model_settings"],
            },
            {
                "system_prompt": "Only saved settings should apply.",
                "chat_model": "gpt-5.4-mini",
                "model_settings": {
                    "temperature": 1.6,
                    "reasoning_effort": "high",
                },
            },
        ]
    finally:
        app.dependency_overrides.pop(get_chat_service, None)


@pytest.mark.asyncio
async def test_running_stream_keeps_send_time_workspace_settings_until_completion(test_client):
    workspace = await create_workspace(test_client, "Workspace Snapshot")

    class BlockingRecordingChatService:
        configure_calls: list[dict[str, object]] = []
        first_delta_emitted = asyncio.Event()
        allow_completion = asyncio.Event()

        def configure_runtime(
            self,
            *,
            system_prompt: str,
            chat_model: str,
            model_settings: dict[str, object],
        ) -> None:
            self.__class__.configure_calls.append(
                {
                    "system_prompt": system_prompt,
                    "chat_model": chat_model,
                    "model_settings": model_settings,
                }
            )

        async def stream_chat(self, messages, user_message):
            yield ChatEvent(state=ChatStreamState.STARTED, response_id="resp_snapshot_1")
            yield ChatEvent(state=ChatStreamState.DELTA, delta="Hello", response_id="resp_snapshot_1")
            self.__class__.first_delta_emitted.set()
            await self.__class__.allow_completion.wait()
            yield ChatEvent(state=ChatStreamState.COMPLETED, response_id="resp_snapshot_1")

        async def generate_title(self, first_message: str) -> str:
            return "Snapshot title"

        async def maybe_close_stream(self, stream) -> None:
            return None

    app.dependency_overrides[get_chat_service] = BlockingRecordingChatService
    BlockingRecordingChatService.configure_calls = []
    BlockingRecordingChatService.first_delta_emitted = asyncio.Event()
    BlockingRecordingChatService.allow_completion = asyncio.Event()

    try:
        response_task = asyncio.create_task(
            test_client.post(
                "/api/chat/stream",
                json={
                    "workspace_id": workspace["workspace_id"],
                    "conversation_id": 0,
                    "message_id": 0,
                    "message": "第一句",
                },
            )
        )

        await BlockingRecordingChatService.first_delta_emitted.wait()

        update_response = await test_client.put(
            f"/api/workspaces/{workspace['workspace_id']}",
            json={
                "name": "Workspace Snapshot",
                "system_message": "Updated while the first stream is still running.",
                "selected_model_id": "gpt-5.4-mini",
                "model_settings": {
                    "temperature": 1.6,
                    "reasoning_effort": "high",
                },
            },
        )
        assert update_response.status_code == 200

        assert BlockingRecordingChatService.configure_calls == [
            {
                "system_prompt": workspace["system_message"],
                "chat_model": workspace["selected_model"]["model_id"],
                "model_settings": workspace["model_settings"],
            }
        ]

        BlockingRecordingChatService.allow_completion.set()
        response = await response_task

        assert response.status_code == 200
        events = parse_sse_payload(response.text)
        assert events[-1] == ("message.done", {"message_id": 1, "status": "completed"})
    finally:
        app.dependency_overrides.pop(get_chat_service, None)


@pytest.mark.asyncio
async def test_first_prompt_creates_conversation_for_workspace_at_acceptance_time(test_client):
    workspace = await create_workspace(test_client)

    before_response = await test_client.get(f"/api/workspaces/{workspace['workspace_id']}/conversations")
    assert before_response.status_code == 200
    assert before_response.json() == []

    response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "請幫我寫標題",
        },
    )

    assert response.status_code == 200
    events = parse_sse_payload(response.text)
    event_names = [name for name, _ in events]
    assert [name for name in event_names if name != "conversation.title"] == [
        "conversation.created",
        "message.created",
        "message.delta",
        "message.delta",
        "message.done",
    ]
    assert "conversation.title" in event_names
    assert event_names.index("conversation.title") < event_names.index("message.done")

    created_conversation = events[0][1]
    assert created_conversation["workspace_id"] == workspace["workspace_id"]
    assert created_conversation["conversation_title"] == "請幫我寫標題"

    conversations_response = await test_client.get(f"/api/workspaces/{workspace['workspace_id']}/conversations")
    assert conversations_response.status_code == 200
    conversations = conversations_response.json()
    assert len(conversations) == 1
    assert conversations[0]["conversation_id"] == created_conversation["conversation_id"]


@pytest.mark.asyncio
async def test_workspace_scoped_conversation_listing_filters_by_workspace_and_recent_activity(test_client):
    workspace_alpha = await create_workspace(test_client, "Workspace Alpha")
    workspace_beta = await create_workspace(test_client, "Workspace Beta")

    first_response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace_alpha["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "第一段對話",
        },
    )
    first_conversation_id = parse_sse_payload(first_response.text)[0][1]["conversation_id"]

    beta_response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace_beta["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "另一個工作區",
        },
    )
    beta_conversation_id = parse_sse_payload(beta_response.text)[0][1]["conversation_id"]

    second_response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace_alpha["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "第二段對話",
        },
    )
    second_conversation_id = parse_sse_payload(second_response.text)[0][1]["conversation_id"]

    alpha_conversations_response = await test_client.get(
        f"/api/workspaces/{workspace_alpha['workspace_id']}/conversations"
    )
    beta_conversations_response = await test_client.get(
        f"/api/workspaces/{workspace_beta['workspace_id']}/conversations"
    )

    assert alpha_conversations_response.status_code == 200
    assert beta_conversations_response.status_code == 200
    assert [item["conversation_id"] for item in alpha_conversations_response.json()] == [
        second_conversation_id,
        first_conversation_id,
    ]
    assert [item["conversation_id"] for item in beta_conversations_response.json()] == [beta_conversation_id]


@pytest.mark.asyncio
async def test_loads_workspace_conversation_history(test_client):
    workspace = await create_workspace(test_client, "Workspace History")

    await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "載入測試",
        },
    )

    conversations_response = await test_client.get(f"/api/workspaces/{workspace['workspace_id']}/conversations")
    assert conversations_response.status_code == 200
    conversations = conversations_response.json()
    assert len(conversations) == 1

    conversation_id = conversations[0]["conversation_id"]
    detail_response = await test_client.get(f"/api/conversations/{conversation_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()

    assert detail["workspace_id"] == workspace["workspace_id"]
    assert detail["messages"][0]["query"] == "載入測試"
    assert detail["messages"][0]["response"] == "Hello world"
    assert detail["messages"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_stopping_stream_persists_partial_response(test_client):
    workspace = await create_workspace(test_client, "Workspace Stop")

    async with test_client.stream(
        "POST",
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "停止測試",
        },
        timeout=30,
    ) as response:
        assert response.status_code == 200
        async for line in response.aiter_lines():
            if line.startswith("data: "):
                break

    await asyncio.sleep(0)

    conversations_response = await test_client.get(f"/api/workspaces/{workspace['workspace_id']}/conversations")
    conversations = conversations_response.json()
    assert len(conversations) == 1

    detail_response = await test_client.get(f"/api/conversations/{conversations[0]['conversation_id']}")
    detail = detail_response.json()
    assert detail["messages"][0]["response"] in {"", "Hello", "Hello world"}
    assert detail["messages"][0]["status"] in {"streaming", "stopped", "completed"}


@pytest.mark.asyncio
async def test_stream_errors_emit_error_event_and_persist_error_status(test_client):
    workspace = await create_workspace(test_client, "Workspace Errors")

    class ErrorChatService:
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
            yield ChatEvent(state=ChatStreamState.STARTED, response_id="resp_error_1")
            yield ChatEvent(state=ChatStreamState.DELTA, delta="Oops", response_id="resp_error_1")
            yield ChatEvent(
                state=ChatStreamState.ERROR,
                error_message="boom",
                error_code="stream_failed",
            )

        async def generate_title(self, first_message: str) -> str:
            return "Error title"

        async def maybe_close_stream(self, stream) -> None:
            return None

    app.dependency_overrides[get_chat_service] = ErrorChatService
    try:
        response = await test_client.post(
            "/api/chat/stream",
            json={
                "workspace_id": workspace["workspace_id"],
                "conversation_id": 0,
                "message_id": 0,
                "message": "錯誤測試",
            },
        )
    finally:
        app.dependency_overrides.pop(get_chat_service, None)

    assert response.status_code == 200
    events = parse_sse_payload(response.text)
    error_event = next(payload for name, payload in events if name == "error")
    assert error_event == {"message": "boom", "code": "stream_failed"}

    conversations_response = await test_client.get(f"/api/workspaces/{workspace['workspace_id']}/conversations")
    conversations = conversations_response.json()
    assert len(conversations) == 1

    detail_response = await test_client.get(f"/api/conversations/{conversations[0]['conversation_id']}")
    detail = detail_response.json()
    assert detail["messages"][0]["response"] == "Oops"
    assert detail["messages"][0]["status"] == "error"


@pytest.mark.asyncio
async def test_turn_override_can_disable_knowledge_answering_for_one_turn(monkeypatch, test_client):
    workspace = await create_workspace(test_client, "Workspace KB Override")

    update_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base-settings",
        json={
            "chunk_size": 800,
            "chunk_overlap": 200,
            "retrieval_top_k": 8,
            "similarity_threshold": 0.2,
            "knowledge_answering_default": True,
        },
    )
    assert update_response.status_code == 200

    async with db_module.SessionLocal() as session:
        current_workspace = (
            await session.execute(select(Workspace).where(Workspace.workspace_id == workspace["workspace_id"]))
        ).scalar_one()
        version = KnowledgeBaseVersion(
            workspace_fk=current_workspace.id,
            version_id="version-override",
            version_number=1,
            status="active",
            collection_name="kb_override_collection",
        )
        session.add(version)
        await session.flush()
        current_workspace.active_knowledge_base_version_fk = version.id
        await session.commit()

    retrieval_calls: list[str] = []

    async def fake_search_workspace_documents(*, workspace_id: str, query: str, session):
        retrieval_calls.append(query)
        return [
            SearchResult(
                knowledge_document_id="doc-1",
                display_filename="guide.md",
                revision_number=1,
                chunk_count=1,
                excerpt="Alpha project milestone notes",
                score=0.91,
            )
        ]

    monkeypatch.setattr(
        "backend.app.services.turn_orchestration.search_workspace_documents",
        fake_search_workspace_documents,
    )

    response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "Skip knowledge for this turn",
            "knowledge_answering_enabled": False,
        },
    )

    assert response.status_code == 200
    assert retrieval_calls == []

    events = parse_sse_payload(response.text)
    done_event = next(payload for name, payload in events if name == "message.done")
    assert done_event == {
        "message_id": 1,
        "status": "completed",
        "knowledge_answering_requested": False,
        "knowledge_answering_used": False,
        "fallback_reason": None,
    }


@pytest.mark.asyncio
async def test_workspace_default_knowledge_answering_builds_query_from_prompt_and_recent_context(
    monkeypatch, test_client
):
    workspace = await create_workspace(test_client, "Workspace KB Query")

    first_response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "Budget spreadsheet for last quarter",
        },
    )
    first_events = parse_sse_payload(first_response.text)
    conversation_id = first_events[0][1]["conversation_id"]

    second_response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": conversation_id,
            "message_id": 0,
            "message": "Alpha project launch plan",
        },
    )
    assert second_response.status_code == 200

    update_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base-settings",
        json={
            "chunk_size": 800,
            "chunk_overlap": 200,
            "retrieval_top_k": 8,
            "similarity_threshold": 0.2,
            "knowledge_answering_default": True,
        },
    )
    assert update_response.status_code == 200

    async with db_module.SessionLocal() as session:
        current_workspace = (
            await session.execute(select(Workspace).where(Workspace.workspace_id == workspace["workspace_id"]))
        ).scalar_one()
        version = KnowledgeBaseVersion(
            workspace_fk=current_workspace.id,
            version_id="version-query",
            version_number=1,
            status="active",
            collection_name="kb_query_collection",
        )
        session.add(version)
        await session.flush()
        current_workspace.active_knowledge_base_version_fk = version.id
        await session.commit()

    captured_queries: list[str] = []

    async def fake_search_workspace_documents(*, workspace_id: str, query: str, session):
        captured_queries.append(query)
        return [
            SearchResult(
                knowledge_document_id="doc-alpha",
                display_filename="alpha-plan.md",
                revision_number=3,
                chunk_count=4,
                excerpt="Milestones: kickoff, beta, launch.",
                score=0.94,
            )
        ]

    monkeypatch.setattr(
        "backend.app.services.turn_orchestration.search_workspace_documents",
        fake_search_workspace_documents,
    )

    response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": conversation_id,
            "message_id": 0,
            "message": "For Alpha, what milestones did we commit to?",
        },
    )

    assert response.status_code == 200
    assert len(captured_queries) == 1
    assert "For Alpha, what milestones did we commit to?" in captured_queries[0]
    assert "Alpha project launch plan" in captured_queries[0]
    assert "Budget spreadsheet for last quarter" not in captured_queries[0]

    events = parse_sse_payload(response.text)
    assert ("sources", {"sources": [
        {
            "knowledge_document_id": "doc-alpha",
            "display_filename": "alpha-plan.md",
            "revision_number": 3,
            "chunk_count": 4,
            "excerpt": "Milestones: kickoff, beta, launch.",
            "score": 0.94,
        }
    ]}) in events
    done_event = next(payload for name, payload in events if name == "message.done")
    assert done_event == {
        "message_id": 3,
        "status": "completed",
        "knowledge_answering_requested": True,
        "knowledge_answering_used": True,
        "fallback_reason": None,
    }


@pytest.mark.asyncio
async def test_knowledge_answering_falls_back_to_plain_chat_when_workspace_has_no_active_version(test_client):
    workspace = await create_workspace(test_client, "Workspace KB Fallback")

    update_response = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base-settings",
        json={
            "chunk_size": 800,
            "chunk_overlap": 200,
            "retrieval_top_k": 8,
            "similarity_threshold": 0.2,
            "knowledge_answering_default": True,
        },
    )
    assert update_response.status_code == 200

    response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "Answer with workspace knowledge if possible",
        },
    )

    assert response.status_code == 200
    events = parse_sse_payload(response.text)
    done_event = next(payload for name, payload in events if name == "message.done")
    assert done_event == {
        "message_id": 1,
        "status": "completed",
        "knowledge_answering_requested": True,
        "knowledge_answering_used": False,
        "fallback_reason": "knowledge_base_unavailable",
    }
    assert all(name != "sources" for name, _ in events)

    conversations_response = await test_client.get(f"/api/workspaces/{workspace['workspace_id']}/conversations")
    conversation_id = conversations_response.json()[0]["conversation_id"]
    detail_response = await test_client.get(f"/api/conversations/{conversation_id}")
    stored_message = detail_response.json()["messages"][0]
    assert stored_message["knowledge_answering_requested"] is True
    assert stored_message["knowledge_answering_used"] is False
    assert stored_message["fallback_reason"] == "knowledge_base_unavailable"
    assert stored_message["sources"] == []


@pytest.mark.asyncio
async def test_disabled_model_workspace_remains_readable_but_blocks_new_generation(test_client):
    workspace = await create_workspace(test_client, "Workspace Disabled")

    first_response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "保留歷史",
        },
    )
    conversation_id = parse_sse_payload(first_response.text)[0][1]["conversation_id"]

    async with db_module.SessionLocal() as session:
        disabled_model = (
            await session.execute(select(ModelCatalog).where(ModelCatalog.model_id == "gpt-4.1-classic"))
        ).scalar_one()
        current_workspace = (
            await session.execute(select(Workspace).where(Workspace.workspace_id == workspace["workspace_id"]))
        ).scalar_one()
        current_workspace.selected_model_fk = disabled_model.id
        await session.commit()

    conversations_response = await test_client.get(f"/api/workspaces/{workspace['workspace_id']}/conversations")
    detail_response = await test_client.get(f"/api/conversations/{conversation_id}")
    blocked_response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": conversation_id,
            "message_id": 0,
            "message": "新的一句",
        },
    )

    assert conversations_response.status_code == 200
    assert len(conversations_response.json()) == 1
    assert detail_response.status_code == 200
    assert detail_response.json()["messages"][0]["query"] == "保留歷史"
    assert blocked_response.status_code == 409
    assert blocked_response.json()["detail"] == "Selected Model is disabled for new generation"


@pytest.mark.asyncio
async def test_deletes_conversation_permanently_and_removes_from_workspace_history(test_client):
    workspace = await create_workspace(test_client, "Workspace Delete")

    stream_response = await test_client.post(
        "/api/chat/stream",
        json={
            "workspace_id": workspace["workspace_id"],
            "conversation_id": 0,
            "message_id": 0,
            "message": "刪除測試",
        },
    )
    assert stream_response.status_code == 200
    conversation_id = parse_sse_payload(stream_response.text)[0][1]["conversation_id"]

    conversations_before = await test_client.get(f"/api/workspaces/{workspace['workspace_id']}/conversations")
    assert conversations_before.status_code == 200
    assert len(conversations_before.json()) == 1

    delete_response = await test_client.delete(f"/api/conversations/{conversation_id}")
    assert delete_response.status_code == 204


# ─── Knowledge Base Jobs ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_post_import_creates_job_and_items_for_workspace(test_client):
    workspace = await create_workspace(test_client, "Workspace KB")

    files = [
        ("files", ("doc_a.txt", b"Content of doc A", "text/plain")),
        ("files", ("doc_b.txt", b"Content of doc B", "text/plain")),
    ]
    response = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=files,
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["workspace_id"] == workspace["workspace_id"]
    assert payload["status"] == "queued"
    assert payload["file_count"] == 2
    assert "job_id" in payload
    assert payload["completed_at"] is None


@pytest.mark.asyncio
async def test_post_import_returns_404_for_unknown_workspace(test_client):
    files = [("files", ("doc.txt", b"Content", "text/plain"))]
    response = await test_client.post(
        "/api/workspaces/no-such-workspace/knowledge-base/import",
        files=files,
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_jobs_returns_active_and_history_structure(test_client):
    workspace = await create_workspace(test_client, "Workspace Jobs")

    response = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs"
    )

    assert response.status_code == 200
    payload = response.json()
    assert "active" in payload
    assert "history" in payload
    assert "history_total" in payload
    assert "history_page" in payload
    assert isinstance(payload["active"], list)
    assert isinstance(payload["history"], list)


@pytest.mark.asyncio
async def test_get_jobs_lists_newly_created_import_job_as_active(test_client):
    workspace = await create_workspace(test_client, "Workspace Jobs 2")

    files = [("files", ("report.txt", b"Report content", "text/plain"))]
    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=files,
    )
    assert import_resp.status_code == 202
    job_id = import_resp.json()["job_id"]

    response = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs"
    )

    assert response.status_code == 200
    payload = response.json()
    active_ids = [j["job_id"] for j in payload["active"]]
    assert job_id in active_ids


@pytest.mark.asyncio
async def test_post_import_eventually_completes_without_manual_advance(test_client):
    workspace = await create_workspace(test_client, "Workspace Auto Worker")

    response = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.txt", b"Background worker import path", "text/plain"))],
    )
    assert response.status_code == 202

    documents_payload = {"documents": []}
    jobs_payload = {"active": [], "history": []}
    for _ in range(40):
        await asyncio.sleep(0.25)
        jobs_response = await test_client.get(
            f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs"
        )
        documents_response = await test_client.get(
            f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
        )
        assert jobs_response.status_code == 200
        assert documents_response.status_code == 200
        jobs_payload = jobs_response.json()
        documents_payload = documents_response.json()
        if documents_payload["documents"] and any(
            job["status"] == "completed" for job in jobs_payload["history"]
        ):
            break

    assert documents_payload["documents"]
    assert documents_payload["documents"][0]["display_filename"] == "guide.txt"
    assert any(job["status"] == "completed" for job in jobs_payload["history"])


@pytest.mark.asyncio
async def test_second_import_is_queued_when_first_job_is_running(test_client):
    from backend.app.services.kb_job_service import advance_import_queue
    from backend.app.db import SessionLocal

    workspace = await create_workspace(test_client, "Workspace Queue")

    files_a = [("files", ("a.txt", b"A content", "text/plain"))]
    files_b = [("files", ("b.txt", b"B content", "text/plain"))]

    first_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=files_a,
    )
    assert first_resp.status_code == 202
    first_job_id = first_resp.json()["job_id"]

    # Manually advance the first job to "running" so the second one is blocked.
    advance_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs/{first_job_id}/advance-to-running",
    )
    assert advance_resp.status_code == 200

    second_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=files_b,
    )
    assert second_resp.status_code == 202
    second_job_id = second_resp.json()["job_id"]
    assert second_resp.json()["status"] == "queued"

    # Worker should not advance the second job while the first is running.
    async with SessionLocal() as session:
        result = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert result is None  # Nothing advanced because first job is still running.

    jobs_resp = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs"
    )
    active_ids = [j["job_id"] for j in jobs_resp.json()["active"]]
    assert second_job_id in active_ids


@pytest.mark.asyncio
async def test_rebuild_job_creates_new_version_and_switches_active_version_only_after_completion(test_client):
    from backend.app.db import SessionLocal
    from backend.app.services.kb_job_service import advance_import_queue

    workspace = await create_workspace(test_client, "Workspace Rebuild")

    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.txt", b"Alpha rebuild baseline", "text/plain"))],
    )
    assert import_resp.status_code == 202

    async with SessionLocal() as session:
        completed_job = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert completed_job is not None
    assert completed_job.status == "completed"

    settings_resp = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base-settings",
        json={
            "chunk_size": 1000,
            "chunk_overlap": 250,
            "retrieval_top_k": 8,
            "similarity_threshold": 0.2,
            "knowledge_answering_default": False,
        },
    )
    assert settings_resp.status_code == 200
    assert settings_resp.json()["rebuild_required"] is True

    rebuild_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/rebuild"
    )
    assert rebuild_resp.status_code == 202
    rebuild_payload = rebuild_resp.json()
    rebuild_job_id = rebuild_payload["job_id"]
    assert rebuild_payload["status"] == "queued"
    assert rebuild_payload["job_type"] == "rebuild"

    async with SessionLocal() as session:
        workspace_row = (
            await session.execute(
                select(Workspace).where(Workspace.workspace_id == workspace["workspace_id"])
            )
        ).scalar_one()
        versions_before = (
            await session.execute(
                select(KnowledgeBaseVersion)
                .where(KnowledgeBaseVersion.workspace_fk == workspace_row.id)
                .order_by(KnowledgeBaseVersion.version_number.asc())
            )
        ).scalars().all()

    assert [version.version_number for version in versions_before] == [1, 2]
    assert workspace_row.active_knowledge_base_version_fk == versions_before[0].id
    assert versions_before[0].status == "active"
    assert versions_before[1].status == "pending"

    search_before_completion = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "Alpha rebuild baseline"},
    )
    assert search_before_completion.status_code == 200
    assert [result["display_filename"] for result in search_before_completion.json()["results"]] == ["guide.txt"]

    async with SessionLocal() as session:
        await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    rebuild_history_job = None
    for _ in range(20):
        jobs_resp = await test_client.get(
            f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs"
        )
        assert jobs_resp.status_code == 200
        rebuild_history_job = next(
            (job for job in jobs_resp.json()["history"] if job["job_id"] == rebuild_job_id),
            None,
        )
        if rebuild_history_job is not None:
            break
        await asyncio.sleep(0.05)

    assert rebuild_history_job is not None
    assert rebuild_history_job["status"] == "completed"
    assert rebuild_history_job["job_type"] == "rebuild"

    async with SessionLocal() as session:
        workspace_row = (
            await session.execute(
                select(Workspace).where(Workspace.workspace_id == workspace["workspace_id"])
            )
        ).scalar_one()
        versions_after = (
            await session.execute(
                select(KnowledgeBaseVersion)
                .where(KnowledgeBaseVersion.workspace_fk == workspace_row.id)
                .order_by(KnowledgeBaseVersion.version_number.asc())
            )
        ).scalars().all()
        kb_settings = (
            await session.execute(
                select(WorkspaceKnowledgeBaseSetting).join(Workspace).where(
                    Workspace.workspace_id == workspace["workspace_id"]
                )
            )
        ).scalar_one()

    assert workspace_row.active_knowledge_base_version_fk == versions_after[1].id
    assert versions_after[0].status == "superseded"
    assert versions_after[1].status == "active"
    assert kb_settings.rebuild_required is False


@pytest.mark.asyncio
async def test_rebuild_is_rejected_while_import_jobs_are_queued_or_running(test_client):
    workspace = await create_workspace(test_client, "Workspace Rebuild Blocked")

    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.txt", b"Queue before rebuild", "text/plain"))],
    )
    assert import_resp.status_code == 202
    job_id = import_resp.json()["job_id"]

    queued_rebuild_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/rebuild"
    )
    assert queued_rebuild_resp.status_code == 409
    assert "queued or running import jobs" in queued_rebuild_resp.json()["detail"]

    advance_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs/{job_id}/advance-to-running",
    )
    assert advance_resp.status_code == 200

    running_rebuild_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/rebuild"
    )
    assert running_rebuild_resp.status_code == 409
    assert "queued or running import jobs" in running_rebuild_resp.json()["detail"]


@pytest.mark.asyncio
async def test_rebuild_uses_only_current_retrievable_revisions_of_non_deleted_documents(test_client):
    from backend.app.db import SessionLocal
    from backend.app.services.kb_job_service import advance_import_queue

    workspace = await create_workspace(test_client, "Workspace Rebuild Scope")

    initial_import = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.txt", b"Alpha historical revision", "text/plain"))],
    )
    assert initial_import.status_code == 202

    async with SessionLocal() as session:
        await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    replacement_import = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.txt", b"Beta active revision", "text/plain"))],
    )
    assert replacement_import.status_code == 202

    async with SessionLocal() as session:
        await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    extra_import = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("ops.txt", b"Gamma deleted document", "text/plain"))],
    )
    assert extra_import.status_code == 202

    async with SessionLocal() as session:
        await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    documents_resp = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
    )
    assert documents_resp.status_code == 200
    documents = documents_resp.json()["documents"]
    ops_document_id = next(
        document["knowledge_document_id"]
        for document in documents
        if document["display_filename"] == "ops.txt"
    )

    delete_resp = await test_client.delete(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents/{ops_document_id}"
    )
    assert delete_resp.status_code == 204

    settings_resp = await test_client.put(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base-settings",
        json={
            "chunk_size": 960,
            "chunk_overlap": 120,
            "retrieval_top_k": 8,
            "similarity_threshold": 0.2,
            "knowledge_answering_default": False,
        },
    )
    assert settings_resp.status_code == 200
    assert settings_resp.json()["rebuild_required"] is True

    rebuild_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/rebuild"
    )
    assert rebuild_resp.status_code == 202

    async with SessionLocal() as session:
        rebuild_job = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert rebuild_job is not None
    assert rebuild_job.status == "completed"
    assert rebuild_job.job_type == "rebuild"

    beta_search_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "Beta active revision"},
    )
    assert beta_search_resp.status_code == 200
    assert [result["display_filename"] for result in beta_search_resp.json()["results"]] == ["guide.txt"]

    alpha_search_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "Alpha historical revision"},
    )
    assert alpha_search_resp.status_code == 200
    alpha_results = alpha_search_resp.json()["results"]
    assert all("Alpha historical revision" not in result["excerpt"] for result in alpha_results)
    assert any("Beta active revision" in result["excerpt"] for result in alpha_results)

    deleted_search_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "Gamma deleted document"},
    )
    assert deleted_search_resp.status_code == 200
    assert all(result["display_filename"] != "ops.txt" for result in deleted_search_resp.json()["results"])


@pytest.mark.asyncio
async def test_cancel_queued_import_job_transitions_to_canceled(test_client):
    workspace = await create_workspace(test_client, "Workspace Cancel")

    files = [("files", ("cancel_me.txt", b"Cancel content", "text/plain"))]
    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=files,
    )
    assert import_resp.status_code == 202
    job_id = import_resp.json()["job_id"]

    cancel_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs/{job_id}/cancel"
    )

    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "canceled"
    assert cancel_resp.json()["job_id"] == job_id


@pytest.mark.asyncio
async def test_cancel_running_import_job_returns_409(test_client):
    workspace = await create_workspace(test_client, "Workspace Cancel 2")

    files = [("files", ("run_me.txt", b"Run content", "text/plain"))]
    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=files,
    )
    assert import_resp.status_code == 202
    job_id = import_resp.json()["job_id"]

    # Advance to running first.
    await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs/{job_id}/advance-to-running",
    )

    cancel_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs/{job_id}/cancel"
    )

    assert cancel_resp.status_code == 409


@pytest.mark.asyncio
async def test_advance_import_queue_completes_queued_job(test_client):
    from backend.app.services.kb_job_service import advance_import_queue
    from backend.app.db import SessionLocal

    workspace = await create_workspace(test_client, "Workspace Worker")

    files = [("files", ("work.txt", b"Work content", "text/plain"))]
    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=files,
    )
    assert import_resp.status_code == 202
    job_id = import_resp.json()["job_id"]

    async with SessionLocal() as session:
        completed_job = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert completed_job is not None
    assert completed_job.job_id == job_id
    assert completed_job.status == "completed"
    assert all(item.status == "imported" for item in completed_job.items)

    # Verify via API that job is in history (not active).
    jobs_resp = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs"
    )
    payload = jobs_resp.json()
    history_ids = [j["job_id"] for j in payload["history"]]
    assert job_id in history_ids
    assert not any(j["job_id"] == job_id for j in payload["active"])


@pytest.mark.asyncio
async def test_completed_import_creates_retrievable_knowledge_document(test_client):
    from backend.app.services.kb_job_service import advance_import_queue
    from backend.app.db import SessionLocal

    workspace = await create_workspace(test_client, "Workspace Documents")

    files = [
        (
            "files",
            (
                "guide.txt",
                b"Alpha project onboarding notes.\nThe retrieval tracer bullet should find this sentence.",
                "text/plain",
            ),
        )
    ]
    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=files,
    )
    assert import_resp.status_code == 202

    async with SessionLocal() as session:
        completed_job = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert completed_job is not None
    assert completed_job.status == "completed"

    documents_resp = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
    )
    assert documents_resp.status_code == 200
    documents_payload = documents_resp.json()
    assert len(documents_payload["documents"]) == 1
    document = documents_payload["documents"][0]
    assert document["display_filename"] == "guide.txt"
    assert document["chunk_count"] >= 1
    assert document["revision_number"] == 1

    search_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "retrieval tracer bullet"},
    )
    assert search_resp.status_code == 200
    search_payload = search_resp.json()
    assert len(search_payload["results"]) == 1
    assert search_payload["results"][0]["display_filename"] == "guide.txt"


@pytest.mark.asyncio
async def test_completed_pdf_import_creates_retrievable_knowledge_document(test_client):
    workspace = await create_workspace(test_client, "Workspace PDF")

    pdf_bytes = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 24 Tf
72 72 Td
(Hello PDF) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000335 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
405
%%EOF"""

    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.pdf", pdf_bytes, "application/pdf"))],
    )
    assert import_resp.status_code == 202

    documents_payload = {"documents": []}
    for _ in range(40):
        await asyncio.sleep(0.25)
        documents_resp = await test_client.get(
            f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
        )
        assert documents_resp.status_code == 200
        documents_payload = documents_resp.json()
        if documents_payload["documents"]:
            break

    assert len(documents_payload["documents"]) == 1
    document = documents_payload["documents"][0]
    assert document["display_filename"] == "guide.pdf"
    assert document["chunk_count"] >= 1
    assert document["revision_number"] == 1

    search_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "Hello PDF"},
    )
    assert search_resp.status_code == 200
    search_payload = search_resp.json()
    assert len(search_payload["results"]) == 1
    assert search_payload["results"][0]["display_filename"] == "guide.pdf"


@pytest.mark.asyncio
async def test_import_dedupes_same_content_and_replaces_revision_for_same_filename(test_client):
    from backend.app.services.kb_job_service import advance_import_queue
    from backend.app.db import SessionLocal

    workspace = await create_workspace(test_client, "Workspace Governance")

    first_import = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.txt", b"Alpha release notes", "text/plain"))],
    )
    assert first_import.status_code == 202

    async with SessionLocal() as session:
        first_job = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert first_job is not None
    assert first_job.items[0].outcome == "imported"

    duplicate_import = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("copy.txt", b"Alpha release notes", "text/plain"))],
    )
    assert duplicate_import.status_code == 202

    async with SessionLocal() as session:
        duplicate_job = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert duplicate_job is not None
    assert duplicate_job.items[0].outcome == "unchanged"

    replacement_import = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.txt", b"Beta release notes", "text/plain"))],
    )
    assert replacement_import.status_code == 202
    replacement_job_id = replacement_import.json()["job_id"]

    async with SessionLocal() as session:
        await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    replacement_history_job = None
    for _ in range(20):
        jobs_resp = await test_client.get(
            f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/jobs"
        )
        assert jobs_resp.status_code == 200
        replacement_history_job = next(
            (job for job in jobs_resp.json()["history"] if job["job_id"] == replacement_job_id),
            None,
        )
        if replacement_history_job is not None:
            break
        await asyncio.sleep(0.05)

    assert replacement_history_job is not None
    assert replacement_history_job["items"][0]["outcome"] == "replaced"

    documents_resp = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
    )
    assert documents_resp.status_code == 200
    documents = documents_resp.json()["documents"]
    assert len(documents) == 1
    assert documents[0]["display_filename"] == "guide.txt"
    assert documents[0]["revision_number"] == 2

    search_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "Beta release"},
    )
    assert search_resp.status_code == 200
    assert [result["display_filename"] for result in search_resp.json()["results"]] == ["guide.txt"]


@pytest.mark.asyncio
async def test_deleting_document_removes_it_from_management_and_search(test_client):
    from backend.app.services.kb_job_service import advance_import_queue
    from backend.app.db import SessionLocal

    workspace = await create_workspace(test_client, "Workspace Delete KB")

    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("ops.txt", b"Gamma support handbook", "text/plain"))],
    )
    assert import_resp.status_code == 202

    async with SessionLocal() as session:
        await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    documents_resp = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
    )
    document_id = documents_resp.json()["documents"][0]["knowledge_document_id"]

    delete_resp = await test_client.delete(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents/{document_id}"
    )
    assert delete_resp.status_code == 204

    documents_after_delete = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
    )
    assert documents_after_delete.status_code == 200
    assert documents_after_delete.json()["documents"] == []

    search_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "Gamma support"},
    )
    assert search_resp.status_code == 200
    assert search_resp.json()["results"] == []


@pytest.mark.asyncio
async def test_failed_replacement_keeps_existing_retrievable_revision_and_unsupported_item_outcome(test_client):
    from backend.app.services.kb_job_service import advance_import_queue
    from backend.app.db import SessionLocal

    workspace = await create_workspace(test_client, "Workspace Failed Revision")

    initial_import = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[("files", ("guide.txt", b"Stable operational runbook", "text/plain"))],
    )
    assert initial_import.status_code == 202

    async with SessionLocal() as session:
        await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    replacement_import = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[
            ("files", ("guide.txt", b"\xff\xfe\xfd", "text/plain")),
            ("files", ("slides.pptx", b"fake pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")),
        ],
    )
    assert replacement_import.status_code == 202

    async with SessionLocal() as session:
        replacement_job = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert replacement_job is not None
    outcomes = {item.filename: item.outcome for item in replacement_job.items}
    assert outcomes["guide.txt"] == "failed"
    assert outcomes["slides.pptx"] == "unsupported"

    documents_resp = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
    )
    assert documents_resp.status_code == 200
    documents = documents_resp.json()["documents"]
    assert len(documents) == 1
    assert documents[0]["display_filename"] == "guide.txt"
    assert documents[0]["revision_number"] == 1

    search_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/search",
        json={"query": "Stable operational"},
    )
    assert search_resp.status_code == 200
    assert [result["display_filename"] for result in search_resp.json()["results"]] == ["guide.txt"]


@pytest.mark.asyncio
async def test_new_failed_or_unsupported_upload_does_not_create_formal_document(test_client):
    from backend.app.services.kb_job_service import advance_import_queue
    from backend.app.db import SessionLocal
    from backend.app.models import KnowledgeDocument, KnowledgeDocumentRevision, Workspace
    from sqlalchemy import select

    workspace = await create_workspace(test_client, "Workspace Failed New File")

    import_resp = await test_client.post(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/import",
        files=[
            ("files", ("broken.txt", b"\xff\xfe\xfd", "text/plain")),
            ("files", ("slides.pptx", b"fake pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")),
        ],
    )
    assert import_resp.status_code == 202

    async with SessionLocal() as session:
        job = await advance_import_queue(workspace["workspace_id"], session)
        await session.commit()

    assert job is not None
    outcomes = {item.filename: item.outcome for item in job.items}
    assert outcomes["broken.txt"] == "failed"
    assert outcomes["slides.pptx"] == "unsupported"

    documents_resp = await test_client.get(
        f"/api/workspaces/{workspace['workspace_id']}/knowledge-base/documents"
    )
    assert documents_resp.status_code == 200
    assert documents_resp.json()["documents"] == []

    async with SessionLocal() as session:
        workspace_row = (
            await session.execute(select(Workspace).where(Workspace.workspace_id == workspace["workspace_id"]))
        ).scalar_one()
        stored_documents = (
            await session.execute(
                select(KnowledgeDocument).where(KnowledgeDocument.workspace_fk == workspace_row.id)
            )
        ).scalars().all()
        stored_revisions = (
            await session.execute(
                select(KnowledgeDocumentRevision).join(
                    KnowledgeDocument,
                    KnowledgeDocumentRevision.knowledge_document_fk == KnowledgeDocument.id,
                ).where(KnowledgeDocument.workspace_fk == workspace_row.id)
            )
        ).scalars().all()

    assert stored_documents == []
    assert stored_revisions == []


@pytest.mark.asyncio
async def test_title_generation_fires_independent_of_mid_stream_workspace_model_change(test_client):
    workspace = await create_workspace(test_client, "Workspace Title Independence")

    class BlockingTitleChatService:
        first_delta_emitted = asyncio.Event()
        allow_completion = asyncio.Event()
        generate_title_calls: list[str] = []

        def configure_runtime(self, *, system_prompt, chat_model, model_settings) -> None:
            pass

        async def stream_chat(self, messages, user_message):
            yield ChatEvent(state=ChatStreamState.STARTED, response_id="resp_title_1")
            yield ChatEvent(state=ChatStreamState.DELTA, delta="Hello", response_id="resp_title_1")
            self.__class__.first_delta_emitted.set()
            await self.__class__.allow_completion.wait()
            yield ChatEvent(state=ChatStreamState.COMPLETED, response_id="resp_title_1")

        async def generate_title(self, first_message: str) -> str:
            self.__class__.generate_title_calls.append(first_message)
            return "Title from message"

        async def maybe_close_stream(self, stream) -> None:
            return None

    app.dependency_overrides[get_chat_service] = BlockingTitleChatService
    BlockingTitleChatService.generate_title_calls = []
    BlockingTitleChatService.first_delta_emitted = asyncio.Event()
    BlockingTitleChatService.allow_completion = asyncio.Event()

    try:
        response_task = asyncio.create_task(
            test_client.post(
                "/api/chat/stream",
                json={
                    "workspace_id": workspace["workspace_id"],
                    "conversation_id": 0,
                    "message_id": 0,
                    "message": "標題獨立測試",
                },
            )
        )

        await BlockingTitleChatService.first_delta_emitted.wait()

        update_response = await test_client.put(
            f"/api/workspaces/{workspace['workspace_id']}",
            json={
                "name": "Workspace Title Independence",
                "system_message": workspace["system_message"],
                "selected_model_id": "gpt-5.4-nano",
                "model_settings": {"temperature": 0.3},
            },
        )
        assert update_response.status_code == 200

        BlockingTitleChatService.allow_completion.set()
        response = await response_task

        assert response.status_code == 200
        events = parse_sse_payload(response.text)
        event_names = [name for name, _ in events]
        title_events = [payload for name, payload in events if name == "conversation.title"]

        assert "conversation.title" in event_names
        assert len(title_events) == 1
        assert title_events[0]["conversation_title"] == "Title from message"
        assert BlockingTitleChatService.generate_title_calls == ["標題獨立測試"]
    finally:
        app.dependency_overrides.pop(get_chat_service, None)


@pytest.mark.asyncio
async def test_deletes_conversation_stops_active_stream_before_removal(test_client):
    workspace = await create_workspace(test_client, "Workspace Stop Delete")

    class BlockingDeleteChatService:
        first_delta_emitted = asyncio.Event()
        proceed_after_delete = asyncio.Event()

        def configure_runtime(self, *, system_prompt, chat_model, model_settings) -> None:
            pass

        async def stream_chat(self, messages, user_message):
            yield ChatEvent(state=ChatStreamState.STARTED, response_id="resp_del_1")
            yield ChatEvent(state=ChatStreamState.DELTA, delta="Hello", response_id="resp_del_1")
            self.__class__.first_delta_emitted.set()
            await self.__class__.proceed_after_delete.wait()
            yield ChatEvent(state=ChatStreamState.DELTA, delta=" world", response_id="resp_del_1")
            yield ChatEvent(state=ChatStreamState.COMPLETED)

        async def generate_title(self, first_message: str) -> str:
            return "Stop delete title"

        async def maybe_close_stream(self, stream) -> None:
            return None

    app.dependency_overrides[get_chat_service] = BlockingDeleteChatService
    BlockingDeleteChatService.first_delta_emitted = asyncio.Event()
    BlockingDeleteChatService.proceed_after_delete = asyncio.Event()

    try:
        response_task = asyncio.create_task(
            test_client.post(
                "/api/chat/stream",
                json={
                    "workspace_id": workspace["workspace_id"],
                    "conversation_id": 0,
                    "message_id": 0,
                    "message": "停止刪除測試",
                },
            )
        )

        await BlockingDeleteChatService.first_delta_emitted.wait()

        conversations_response = await test_client.get(
            f"/api/workspaces/{workspace['workspace_id']}/conversations"
        )
        assert conversations_response.status_code == 200
        conversations = conversations_response.json()
        assert len(conversations) == 1
        conversation_id = conversations[0]["conversation_id"]

        delete_response = await test_client.delete(f"/api/conversations/{conversation_id}")
        assert delete_response.status_code == 204

        BlockingDeleteChatService.proceed_after_delete.set()

        response = await response_task
        assert response.status_code == 200

        events = parse_sse_payload(response.text)
        done_events = [(name, payload) for name, payload in events if name == "message.done"]
        assert len(done_events) == 1
        assert done_events[0][1]["status"] == "stopped"

        conversations_after = await test_client.get(
            f"/api/workspaces/{workspace['workspace_id']}/conversations"
        )
        assert conversations_after.status_code == 200
        assert conversations_after.json() == []

        detail_response = await test_client.get(f"/api/conversations/{conversation_id}")
        assert detail_response.status_code == 404
    finally:
        app.dependency_overrides.pop(get_chat_service, None)


@pytest.mark.asyncio
async def test_get_db_session_ignores_close_errors(monkeypatch):
    from backend.app import db as db_module

    class BrokenSession:
        async def close(self) -> None:
            raise OperationalError("ROLLBACK", {}, ValueError("no active connection"))

    monkeypatch.setattr(db_module, "SessionLocal", lambda: BrokenSession())

    generator = db_module.get_db_session()
    session = await generator.__anext__()
    assert isinstance(session, BrokenSession)
    await generator.aclose()
