from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .models import Message


DEFAULT_CHAT_SYSTEM_PROMPT = (
    "You are a helpful assistant for a minimal chat application. "
    "Answer clearly, stay grounded in the user's conversation history, "
    "and format naturally for plain-text chat."
)

TITLE_INSTRUCTIONS = (
    "Generate a short conversation title in Traditional Chinese when appropriate. "
    "Keep it within 20 characters, no quotes, no markdown, and no trailing punctuation."
)


class PromptBuilder:
    def __init__(self, system_prompt: str) -> None:
        self.system_prompt = system_prompt

    def build_chat_messages(self, messages: list["Message"], user_message: str) -> list[Any]:
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

        prompt_messages: list[Any] = [SystemMessage(content=self.system_prompt)]
        for message in messages:
            prompt_messages.append(HumanMessage(content=message.query))
            if message.response:
                prompt_messages.append(AIMessage(content=message.response))
        prompt_messages.append(HumanMessage(content=user_message))
        return prompt_messages


def build_title_messages(first_message: str) -> list[Any]:
    from langchain_core.messages import HumanMessage, SystemMessage

    return [
        SystemMessage(content=TITLE_INSTRUCTIONS),
        HumanMessage(content=first_message),
    ]
