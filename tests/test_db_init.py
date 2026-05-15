from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.mark.asyncio
async def test_init_db_rebuilds_legacy_conversation_schema(tmp_path, monkeypatch):
    from backend.app import db as db_module

    database_path = tmp_path / "legacy.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}", future=True)
    session_local = async_sessionmaker(engine, expire_on_commit=False)

    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", session_local)

    async with engine.begin() as connection:
        await connection.execute(
            text(
                """
                CREATE TABLE conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id VARCHAR(36) NOT NULL,
                    conversation_title VARCHAR(120) NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )

    await db_module.init_db()

    async with engine.begin() as connection:
        result = await connection.execute(text("PRAGMA table_info(conversations)"))
        columns = {row[1] for row in result.fetchall()}

    await engine.dispose()

    assert "workspace_fk" in columns
