import json
from collections.abc import AsyncIterator
from typing import Any


def format_sse_event(event: str, data: dict[str, Any]) -> bytes:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


async def iter_sse(events: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    yield b": connected\n\n"
    async for event in events:
        yield event
