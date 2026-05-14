import asyncio
import json

import pytest
from sqlalchemy.exc import OperationalError

from backend.app.chat_events import ChatEvent, ChatStreamState
from backend.app.main import app
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


@pytest.mark.asyncio
async def test_creates_new_conversation_and_streams_messages(test_client):
    response = await test_client.post(
        "/api/chat/stream",
        json={"conversation_id": 0, "message_id": 0, "message": "請幫我寫標題"},
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
    assert events[0][1]["conversation_title"] == "請幫我寫標題"
    created_event = next(payload for name, payload in events if name == "message.created")
    delta_events = [payload for name, payload in events if name == "message.delta"]
    title_event = next(payload for name, payload in events if name == "conversation.title")
    done_event = next(payload for name, payload in events if name == "message.done")
    assert created_event["message_id"] > 0
    assert [payload["delta"] for payload in delta_events] == ["Hello", " world"]
    assert title_event["conversation_title"] == "Test title"
    assert done_event["status"] == "completed"


@pytest.mark.asyncio
async def test_lists_and_loads_conversation_history(test_client):
    await test_client.post(
        "/api/chat/stream",
        json={"conversation_id": 0, "message_id": 0, "message": "載入測試"},
    )

    conversations_response = await test_client.get("/api/conversations")
    assert conversations_response.status_code == 200
    conversations = conversations_response.json()
    assert len(conversations) == 1

    conversation_id = conversations[0]["conversation_id"]
    detail_response = await test_client.get(f"/api/conversations/{conversation_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()

    assert detail["messages"][0]["query"] == "載入測試"
    assert detail["messages"][0]["response"] == "Hello world"
    assert detail["messages"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_stopping_stream_persists_partial_response(test_client):
    async with test_client.stream(
        "POST",
        "/api/chat/stream",
        json={"conversation_id": 0, "message_id": 0, "message": "停止測試"},
        timeout=30,
    ) as response:
        assert response.status_code == 200
        async for line in response.aiter_lines():
            if line.startswith("data: "):
                break

    await asyncio.sleep(0)

    conversations_response = await test_client.get("/api/conversations")
    conversations = conversations_response.json()
    assert len(conversations) == 1

    detail_response = await test_client.get(f"/api/conversations/{conversations[0]['conversation_id']}")
    detail = detail_response.json()
    assert detail["messages"][0]["response"] in {"", "Hello", "Hello world"}
    assert detail["messages"][0]["status"] in {"streaming", "stopped", "completed"}


@pytest.mark.asyncio
async def test_stream_errors_emit_error_event_and_persist_error_status(test_client):
    class ErrorChatService:
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
            json={"conversation_id": 0, "message_id": 0, "message": "錯誤測試"},
        )
    finally:
        app.dependency_overrides.pop(get_chat_service, None)

    assert response.status_code == 200
    events = parse_sse_payload(response.text)
    error_event = next(payload for name, payload in events if name == "error")
    assert error_event == {"message": "boom", "code": "stream_failed"}

    conversations_response = await test_client.get("/api/conversations")
    conversations = conversations_response.json()
    assert len(conversations) == 1

    detail_response = await test_client.get(f"/api/conversations/{conversations[0]['conversation_id']}")
    detail = detail_response.json()
    assert detail["messages"][0]["response"] == "Oops"
    assert detail["messages"][0]["status"] == "error"


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
