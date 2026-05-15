import asyncio
import json

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from backend.app.chat_events import ChatEvent, ChatStreamState
from backend.app import db as db_module
from backend.app.config import get_settings
from backend.app.main import app
from backend.app.models import ModelCatalog, Workspace, WorkspaceModelSetting
from backend.app.routes import get_chat_service


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
