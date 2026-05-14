import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
import sys

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.chat_events import ChatEvent, ChatStreamState
from backend.app.db import Base
from backend.app.main import app
from backend.app.routes import get_chat_service


class FakeChatService:
    def __init__(self) -> None:
        self.closed = False
        self.title = "Test title"

    async def stream_chat(self, messages, user_message):
        yield ChatEvent(state=ChatStreamState.STARTED, response_id="resp_test_1")
        await asyncio.sleep(0)
        yield ChatEvent(state=ChatStreamState.DELTA, delta="Hello", response_id="resp_test_1")
        await asyncio.sleep(0)
        yield ChatEvent(state=ChatStreamState.DELTA, delta=" world", response_id="resp_test_1")
        await asyncio.sleep(0)
        yield ChatEvent(state=ChatStreamState.COMPLETED)

    async def generate_title(self, first_message: str) -> str:
        return self.title

    async def maybe_close_stream(self, stream) -> None:
        self.closed = True


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

    app.dependency_overrides[get_chat_service] = FakeChatService

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()
    await engine.dispose()
