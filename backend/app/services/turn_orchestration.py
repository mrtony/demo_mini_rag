from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .. import db as db_module
from ..models import Message, Workspace
from ..prompt_builder import PromptBuilder
from .kb_document_service import SearchResult, search_workspace_documents


KNOWLEDGE_BASE_UNAVAILABLE = "knowledge_base_unavailable"
RETRIEVAL_INSUFFICIENT = "retrieval_insufficient"

_TOKEN_PATTERN = re.compile(r"[a-zA-Z0-9]{3,}")
_STOPWORDS = {
    "and",
    "did",
    "for",
    "from",
    "have",
    "into",
    "that",
    "the",
    "this",
    "what",
    "with",
}


@dataclass(slots=True)
class TurnPlan:
    prompt_messages: list[Any] | None
    knowledge_answering_requested: bool
    knowledge_answering_used: bool
    fallback_reason: str | None
    retrieval_query: str | None
    sources: list[dict[str, Any]]
    knowledge_base_version_fk: int | None
    retrieval_top_k: int | None
    similarity_threshold: float | None
    emit_metadata: bool


def _tokenize(text: str) -> set[str]:
    return {
        token.lower()
        for token in _TOKEN_PATTERN.findall(text)
        if token.lower() not in _STOPWORDS
    }


def _recent_relevant_context(messages: list[Message], user_message: str, limit: int = 2) -> list[str]:
    prompt_tokens = _tokenize(user_message)
    ranked_messages: list[tuple[int, int, str]] = []

    for recency_index, message in enumerate(reversed(messages[-6:])):
        candidate = message.query.strip()
        if not candidate:
            continue
        score = len(prompt_tokens & _tokenize(candidate))
        if score <= 0:
            continue
        ranked_messages.append((score, -recency_index, candidate))

    ranked_messages.sort(reverse=True)
    return [candidate for _, _, candidate in ranked_messages[:limit]]


def _build_retrieval_query(messages: list[Message], user_message: str) -> str:
    relevant_context = _recent_relevant_context(messages, user_message)
    query_sections = [f"User question: {user_message}"]
    if relevant_context:
        query_sections.append("Relevant recent context:")
        query_sections.extend(f"- {item}" for item in relevant_context)
    return "\n".join(query_sections)


def _serialize_sources(results: list[SearchResult]) -> list[dict[str, Any]]:
    serialized_sources: list[dict[str, Any]] = []
    for result in results:
        source = {
            "knowledge_document_id": result.knowledge_document_id,
            "display_filename": result.display_filename,
            "revision_number": result.revision_number,
            "chunk_count": result.chunk_count,
            "excerpt": result.excerpt,
            "score": result.score,
        }
        if result.page_number is not None:
            source["page_number"] = result.page_number
        if result.slide_number is not None:
            source["slide_number"] = result.slide_number
        serialized_sources.append(source)
    return serialized_sources


async def plan_chat_turn(
    *,
    workspace: Workspace,
    messages: list[Message],
    user_message: str,
    knowledge_answering_enabled: bool | None,
) -> TurnPlan:
    knowledge_settings = workspace.knowledge_base_setting
    workspace_default = (
        knowledge_settings.knowledge_answering_default if knowledge_settings is not None else False
    )
    requested = workspace_default if knowledge_answering_enabled is None else knowledge_answering_enabled
    emit_metadata = knowledge_answering_enabled is not None or workspace_default

    if not requested:
        return TurnPlan(
            prompt_messages=None,
            knowledge_answering_requested=False,
            knowledge_answering_used=False,
            fallback_reason=None,
            retrieval_query=None,
            sources=[],
            knowledge_base_version_fk=None,
            retrieval_top_k=None,
            similarity_threshold=None,
            emit_metadata=emit_metadata,
        )

    if workspace.active_knowledge_base_version is None:
        return TurnPlan(
            prompt_messages=None,
            knowledge_answering_requested=True,
            knowledge_answering_used=False,
            fallback_reason=KNOWLEDGE_BASE_UNAVAILABLE,
            retrieval_query=None,
            sources=[],
            knowledge_base_version_fk=None,
            retrieval_top_k=None,
            similarity_threshold=None,
            emit_metadata=True,
        )

    retrieval_query = _build_retrieval_query(messages, user_message)
    retrieval_top_k = knowledge_settings.retrieval_top_k
    similarity_threshold = knowledge_settings.similarity_threshold
    async with db_module.SessionLocal() as session:
        results = await search_workspace_documents(
            workspace_id=workspace.workspace_id,
            query=retrieval_query,
            session=session,
        )

    if not results:
        return TurnPlan(
            prompt_messages=None,
            knowledge_answering_requested=True,
            knowledge_answering_used=False,
            fallback_reason=RETRIEVAL_INSUFFICIENT,
            retrieval_query=retrieval_query,
            sources=[],
            knowledge_base_version_fk=workspace.active_knowledge_base_version.id,
            retrieval_top_k=retrieval_top_k,
            similarity_threshold=similarity_threshold,
            emit_metadata=True,
        )

    sources = _serialize_sources(results)
    prompt_messages = PromptBuilder(workspace.system_message).build_knowledge_answering_messages(
        messages=messages,
        user_message=user_message,
        retrieval_query=retrieval_query,
        retrieved_sources=sources,
    )
    return TurnPlan(
        prompt_messages=prompt_messages,
        knowledge_answering_requested=True,
        knowledge_answering_used=True,
        fallback_reason=None,
        retrieval_query=retrieval_query,
        sources=sources,
        knowledge_base_version_fk=workspace.active_knowledge_base_version.id,
        retrieval_top_k=retrieval_top_k,
        similarity_threshold=similarity_threshold,
        emit_metadata=True,
    )
