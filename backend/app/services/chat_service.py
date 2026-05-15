from __future__ import annotations

import inspect
import logging
from collections.abc import AsyncIterator
from typing import Any

from ..chat_events import ChatEvent, ChatStreamState
from ..config import Settings, get_settings
from ..models import Message
from ..prompt_builder import PromptBuilder, build_title_messages


logger = logging.getLogger(__name__)


class ChatService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._chat_model: Any | None = None
        self._title_model: Any | None = None
        self._prompt_builder = PromptBuilder(self.settings.chat_system_prompt)
        self._runtime_chat_model: str | None = None
        self._runtime_model_settings: dict[str, Any] = {}

    def configure_runtime(
        self,
        *,
        system_prompt: str,
        chat_model: str,
        model_settings: dict[str, Any],
    ) -> None:
        self._prompt_builder = PromptBuilder(system_prompt)
        if self._runtime_chat_model != chat_model or self._runtime_model_settings != model_settings:
            self._chat_model = None
            self._runtime_chat_model = chat_model
            self._runtime_model_settings = dict(model_settings)

    def _get_chat_model(self) -> Any:
        if self._chat_model is None:
            from langchain_openai import ChatOpenAI

            model_kwargs: dict[str, Any] = {
                "api_key": self.settings.openai_api_key,
                "model": self._runtime_chat_model or self.settings.chat_model,
            }
            if "temperature" in self._runtime_model_settings:
                model_kwargs["temperature"] = self._runtime_model_settings["temperature"]
            if "reasoning_effort" in self._runtime_model_settings:
                model_kwargs["reasoning_effort"] = self._runtime_model_settings["reasoning_effort"]

            self._chat_model = ChatOpenAI(
                **model_kwargs,
            )
        return self._chat_model

    def _get_title_model(self) -> Any:
        if self._title_model is None:
            from langchain_openai import ChatOpenAI

            self._title_model = ChatOpenAI(
                api_key=self.settings.openai_api_key,
                model=self.settings.title_model,
            )
        return self._title_model

    async def stream_chat(self, messages: list[Message], user_message: str) -> AsyncIterator[ChatEvent]:
        prompt_messages = self._prompt_builder.build_chat_messages(messages, user_message)
        logger.info(
            "Starting LangChain chat stream with %s stored messages and prompt length %s",
            len(messages),
            len(user_message),
        )
        yield ChatEvent(state=ChatStreamState.STARTED)

        try:
            async for event in self._get_chat_model().astream_events(prompt_messages, version="v2"):
                mapped_event = self._map_langchain_event(event)
                if mapped_event is None:
                    continue
                yield mapped_event
        except Exception as exc:
            logger.exception("Chat stream failed during LangChain execution: %s", exc)
            yield ChatEvent(
                state=ChatStreamState.ERROR,
                error_message=str(exc),
                error_code="stream_failed",
            )

    async def generate_title(self, first_message: str) -> str:
        logger.info("Generating title for first message length %s", len(first_message))
        messages = build_title_messages(first_message)
        response = await self._get_title_model().ainvoke(messages)
        title = self._extract_text(response).strip()
        if not title:
            title = first_message.strip()
        return title[: self.settings.title_max_length]

    def _map_langchain_event(self, event: dict[str, Any]) -> ChatEvent | None:
        event_name = event.get("event", "")
        data = event.get("data", {})

        if event_name == "on_chat_model_stream":
            chunk = data.get("chunk")
            delta = self._extract_text(chunk)
            if not delta:
                return None
            metadata = event.get("metadata", {})
            return ChatEvent(
                state=ChatStreamState.DELTA,
                delta=delta,
                response_id=self._extract_response_id(metadata),
            )

        if event_name == "on_chat_model_end":
            output = data.get("output")
            metadata = event.get("metadata", {})
            return ChatEvent(
                state=ChatStreamState.COMPLETED,
                response_id=self._extract_response_id(metadata) or self._extract_response_id(output),
            )

        return None

    @staticmethod
    def _extract_response_id(payload: Any) -> str | None:
        if payload is None:
            return None
        if isinstance(payload, dict):
            for key in ("response_id", "id", "run_id", "ls_provider_response_id"):
                value = payload.get(key)
                if isinstance(value, str) and value:
                    return value
            return None
        for key in ("response_id", "id", "run_id"):
            value = getattr(payload, key, None)
            if isinstance(value, str) and value:
                return value
        return None

    @staticmethod
    def _extract_text(payload: Any) -> str:
        if payload is None:
            return ""
        if isinstance(payload, str):
            return payload
        if isinstance(payload, list):
            return "".join(ChatService._extract_text(item) for item in payload)
        if isinstance(payload, dict):
            if isinstance(payload.get("text"), str):
                return payload["text"]
            if isinstance(payload.get("content"), str):
                return payload["content"]
            if isinstance(payload.get("content"), list):
                return ChatService._extract_text(payload["content"])

        text = getattr(payload, "text", None)
        if isinstance(text, str):
            return text

        content = getattr(payload, "content", None)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(ChatService._extract_text(item) for item in content)

        return ""

    @staticmethod
    async def maybe_close_stream(stream: Any) -> None:
        close = getattr(stream, "aclose", None)
        if close is None:
            close = getattr(stream, "close", None)
        if close is None:
            return
        result = close()
        if inspect.isawaitable(result):
            await result
