from __future__ import annotations

import inspect
import logging
from typing import Any

from openai import AsyncOpenAI

from ..config import Settings, get_settings


TITLE_INSTRUCTIONS = (
    "Generate a short conversation title in Traditional Chinese when appropriate. "
    "Keep it within 20 characters, no quotes, no markdown, and no trailing punctuation."
)
logger = logging.getLogger(__name__)


class OpenAIService:
    def __init__(self, settings: Settings | None = None, client: Any | None = None) -> None:
        self.settings = settings or get_settings()
        self.client = client

    def _get_client(self) -> AsyncOpenAI:
        if self.client is None:
            self.client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        return self.client

    async def stream_chat(self, history: list[dict[str, str]], user_message: str) -> Any:
        input_items = [*history, {"role": "user", "content": user_message}]
        logger.info(
            "Sending chat request to OpenAI with %s history items and message length %s",
            len(history),
            len(user_message),
        )
        return await self._get_client().responses.create(
            model=self.settings.openai_chat_model,
            input=input_items,
            stream=True,
        )

    async def generate_title(self, first_message: str) -> str:
        logger.info("Generating title for first message length %s", len(first_message))
        response = await self._get_client().responses.create(
            model=self.settings.openai_title_model,
            instructions=TITLE_INSTRUCTIONS,
            input=first_message,
        )
        title = self._extract_output_text(response).strip()
        if not title:
            title = first_message.strip()
        return title[: self.settings.title_max_length]

    @staticmethod
    def _extract_output_text(response: Any) -> str:
        output_text = getattr(response, "output_text", None)
        if isinstance(output_text, str):
            return output_text

        if isinstance(response, dict):
            if isinstance(response.get("output_text"), str):
                return response["output_text"]
            output = response.get("output") or []
        else:
            output = getattr(response, "output", []) or []

        parts: list[str] = []
        for item in output:
            content = item.get("content") if isinstance(item, dict) else getattr(item, "content", [])
            for part in content or []:
                part_type = part.get("type") if isinstance(part, dict) else getattr(part, "type", None)
                if part_type == "output_text":
                    text = part.get("text") if isinstance(part, dict) else getattr(part, "text", "")
                    if text:
                        parts.append(text)
        return "".join(parts)

    @staticmethod
    async def maybe_close_stream(stream: Any) -> None:
        close = getattr(stream, "close", None)
        if close is None:
            return
        result = close()
        if inspect.isawaitable(result):
            await result
