import logging
import time
from collections.abc import AsyncIterator
from contextlib import suppress

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
logger = logging.getLogger(__name__)
db_logger = logging.getLogger("app.db.crud")
engine: AsyncEngine = create_async_engine(settings.database_url, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def _crud_operation(statement: str) -> str | None:
    normalized = statement.lstrip().upper()
    for operation in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        if normalized.startswith(operation):
            return operation
    return None


def _compact_sql(statement: str) -> str:
    return " ".join(statement.split())


if settings.log_db_crud:
    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def before_cursor_execute(_, __, statement, parameters, context, ___):
        operation = _crud_operation(statement)
        if operation is None:
            return
        context._crud_log_started_at = time.perf_counter()
        context._crud_log_operation = operation
        context._crud_log_statement = _compact_sql(statement)
        context._crud_log_parameters = parameters


    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def after_cursor_execute(_, __, statement, parameters, context, executemany):
        operation = getattr(context, "_crud_log_operation", None) or _crud_operation(statement)
        if operation is None:
            return
        started_at = getattr(context, "_crud_log_started_at", None)
        elapsed_ms = ((time.perf_counter() - started_at) * 1000) if started_at is not None else None
        db_logger.info(
            "DB %s | rows=%s | many=%s | duration_ms=%s | sql=%s | params=%r",
            operation,
            getattr(context, "rowcount", None),
            executemany,
            f"{elapsed_ms:.2f}" if elapsed_ms is not None else "n/a",
            getattr(context, "_crud_log_statement", _compact_sql(statement)),
            getattr(context, "_crud_log_parameters", parameters),
        )


    @event.listens_for(engine.sync_engine, "handle_error")
    def handle_error(exception_context):
        operation = _crud_operation(exception_context.statement or "")
        if operation is None:
            return
        db_logger.exception(
            "DB %s failed | sql=%s | params=%r",
            operation,
            _compact_sql(exception_context.statement or ""),
            exception_context.parameters,
        )


async def get_db_session() -> AsyncIterator[AsyncSession]:
    session = SessionLocal()
    try:
        yield session
    finally:
        # Client disconnects can tear down the underlying SQLite connection
        # before SQLAlchemy finishes its implicit rollback during close().
        with suppress(OperationalError, ValueError):
            await session.close()


async def init_db() -> None:
    from . import models  # noqa: F401

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    logger.info("Database initialized")
