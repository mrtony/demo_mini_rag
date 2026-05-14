import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
import sys

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.db import Base
from backend.app.main import app
from backend.app.routes import get_openai_service


class FakeEvent:
    def __init__(self, event_type: str, delta: str = "", response_id: str | None = None) -> None:
        self.type = event_type
        self.delta = delta
        self.response = type("ResponseRef", (), {"id": response_id})() if response_id else None


class FakeStream:
    def __init__(self, events: list[FakeEvent]) -> None:
        self.events = events
        self.closed = False

    def __aiter__(self):
        self._index = 0
        return self

    async def __anext__(self):
        if self._index >= len(self.events):
            raise StopAsyncIteration
        await asyncio.sleep(0)
        item = self.events[self._index]
        self._index += 1
        return item

    async def close(self) -> None:
        self.closed = True


class FakeOpenAIService:
    def __init__(self) -> None:
        self.stream = FakeStream(
            [
                FakeEvent("response.created", response_id="resp_test_1"),
                FakeEvent("response.output_text.delta", delta="Hello"),
                FakeEvent("response.output_text.delta", delta=" world"),
                FakeEvent("response.completed"),
            ]
        )
        self.title = "Test title"

    async def stream_chat(self, history, user_message):
        return self.stream

    async def generate_title(self, first_message: str) -> str:
        return self.title

    async def maybe_close_stream(self, stream) -> None:
        await stream.close()


@pytest_asyncio.fixture()
async def test_client(tmp_path) -> AsyncIterator[AsyncClient]:
    from backend.app import db as db_module
    from backend.app import routes as routes_module

    database_path = tmp_path / "test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)

    db_module.engine = engine
    db_module.SessionLocal = session_local
    routes_module.SessionLocal = session_local

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    app.dependency_overrides[get_openai_service] = FakeOpenAIService

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()
    await engine.dispose()
