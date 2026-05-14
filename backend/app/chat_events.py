from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class ChatStreamState(StrEnum):
    STARTED = "started"
    DELTA = "delta"
    COMPLETED = "completed"
    ERROR = "error"
    TITLE = "title"
    SOURCES = "sources"


@dataclass(slots=True)
class ChatEvent:
    state: ChatStreamState
    delta: str = ""
    response_id: str | None = None
    error_message: str | None = None
    error_code: str | None = None
    title: str | None = None
    sources: list[Any] = field(default_factory=list)
