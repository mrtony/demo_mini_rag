from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .models import Message


DEFAULT_CHAT_SYSTEM_PROMPT = (
    "You are a helpful assistant for a minimal chat application. "
    "Answer clearly, stay grounded in the user's conversation history, "
    "and format naturally for plain-text chat."
)

KNOWLEDGE_ANSWERING_INSTRUCTIONS = (
    "Use the retrieved workspace knowledge as your primary evidence. "
    "Do not invent facts beyond the retrieved evidence. "
    "If the evidence is incomplete, say what is uncertain."
)

TITLE_INSTRUCTIONS = (
    "Generate a short conversation title in Traditional Chinese when appropriate. "
    "Keep it within 20 characters, no quotes, no markdown, and no trailing punctuation."
)


class PromptBuilder:
    def __init__(self, system_prompt: str) -> None:
        self.system_prompt = system_prompt

    def _build_history_messages(self, messages: list["Message"]) -> list[Any]:
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

        prompt_messages: list[Any] = [SystemMessage(content=self.system_prompt)]
        for message in messages:
            prompt_messages.append(HumanMessage(content=message.query))
            if message.response:
                prompt_messages.append(AIMessage(content=message.response))
        return prompt_messages

    def build_chat_messages(self, messages: list["Message"], user_message: str) -> list[Any]:
        from langchain_core.messages import HumanMessage

        prompt_messages = self._build_history_messages(messages)
        prompt_messages.append(HumanMessage(content=user_message))
        return prompt_messages

    def build_knowledge_answering_messages(
        self,
        messages: list["Message"],
        user_message: str,
        retrieval_query: str,
        retrieved_sources: list[dict[str, Any]],
    ) -> list[Any]:
        from langchain_core.messages import HumanMessage, SystemMessage

        evidence_sections = []
        for index, source in enumerate(retrieved_sources, start=1):
            evidence_sections.append(
                "\n".join(
                    [
                        f"Source {index}: {source['display_filename']}",
                        f"Revision: {source['revision_number']}",
                        f"Score: {source['score']}",
                        f"Excerpt: {source['excerpt']}",
                    ]
                )
            )

        prompt_messages = self._build_history_messages(messages)
        prompt_messages.append(
            SystemMessage(
                content="\n\n".join(
                    [
                        KNOWLEDGE_ANSWERING_INSTRUCTIONS,
                        f"Retrieval query:\n{retrieval_query}",
                        "Retrieved evidence:\n" + "\n\n".join(evidence_sections),
                    ]
                )
            )
        )
        prompt_messages.append(HumanMessage(content=user_message))
        return prompt_messages


def build_title_messages(first_message: str) -> list[Any]:
    from langchain_core.messages import HumanMessage, SystemMessage

    return [
        SystemMessage(content=TITLE_INSTRUCTIONS),
        HumanMessage(content=first_message),
    ]
