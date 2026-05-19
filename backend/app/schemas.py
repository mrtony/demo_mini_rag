from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class ChatStreamRequest(BaseModel):
    workspace_id: str | None = None
    conversation_id: str | int = Field(default=0)
    message_id: int = 0
    message: str = Field(min_length=1)
    knowledge_answering_enabled: bool | None = None


class SourceCitation(BaseModel):
    knowledge_document_id: str
    display_filename: str
    revision_number: int
    chunk_count: int
    excerpt: str
    score: float


class ModelCatalogSummary(BaseModel):
    model_id: str
    label: str
    is_enabled: bool
    is_default_workspace_model: bool


class ModelCatalogEntry(ModelCatalogSummary):
    supports_system_message: bool
    settings_schema: dict[str, dict[str, Any]]
    settings_defaults: dict[str, Any]
    sort_order: int


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(min_length=3, max_length=120)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 3:
            raise ValueError("Workspace Name must be at least three characters long")
        return normalized


class WorkspaceUpdateRequest(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    system_message: str = Field(min_length=1)
    selected_model_id: str = Field(min_length=1)
    model_settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 3:
            raise ValueError("Workspace Name must be at least three characters long")
        return normalized

    @field_validator("system_message")
    @classmethod
    def validate_system_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("System Message cannot be blank")
        return normalized


class WorkspaceReorderRequest(BaseModel):
    workspace_ids: list[str] = Field(min_length=1)


class KnowledgeBaseSettingsUpdateRequest(BaseModel):
    chunk_size: int = Field(ge=1)
    chunk_overlap: int = Field(ge=0)
    retrieval_top_k: int = Field(ge=1)
    similarity_threshold: float = Field(ge=0, le=1)
    knowledge_answering_default: bool = False

    @model_validator(mode="after")
    def validate_chunk_overlap(self) -> "KnowledgeBaseSettingsUpdateRequest":
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("Chunk Overlap must be smaller than Chunk Size")
        return self


class WorkspaceSummary(BaseModel):
    workspace_id: str
    name: str
    system_message: str
    selected_model: ModelCatalogSummary
    model_settings: dict[str, Any]
    sort_order: int
    created_at: datetime
    updated_at: datetime


class KnowledgeBaseSettingsSummary(BaseModel):
    workspace_id: str
    chunk_size: int
    chunk_overlap: int
    retrieval_top_k: int
    similarity_threshold: float
    knowledge_answering_default: bool
    rebuild_required: bool


class KnowledgeBaseJobItemSummary(BaseModel):
    item_id: str
    filename: str
    status: str
    outcome: str | None = None
    error_message: str | None = None


class KnowledgeBaseJobSummary(BaseModel):
    job_id: str
    workspace_id: str
    job_type: str
    status: str
    file_count: int
    created_at: datetime
    items: list[KnowledgeBaseJobItemSummary] = Field(default_factory=list)
    completed_at: datetime | None = None


class KnowledgeBaseJobListResponse(BaseModel):
    active: list[KnowledgeBaseJobSummary]
    history: list[KnowledgeBaseJobSummary]
    history_total: int
    history_page: int


class KnowledgeDocumentSummary(BaseModel):
    knowledge_document_id: str
    display_filename: str
    revision_number: int
    chunk_count: int
    locator_summary: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class KnowledgeDocumentListResponse(BaseModel):
    documents: list[KnowledgeDocumentSummary]


class KnowledgeBaseSearchRequest(BaseModel):
    query: str = Field(min_length=1)


class KnowledgeBaseSearchResult(BaseModel):
    knowledge_document_id: str
    display_filename: str
    revision_number: int
    chunk_count: int
    excerpt: str
    score: float


class KnowledgeBaseSearchResponse(BaseModel):
    results: list[KnowledgeBaseSearchResult]


class ConversationSummary(BaseModel):
    workspace_id: str
    conversation_id: str
    conversation_title: str
    updated_at: datetime


class StoredMessage(BaseModel):
    id: int
    query: str
    response: str
    status: str
    knowledge_answering_requested: bool = False
    knowledge_answering_used: bool = False
    fallback_reason: str | None = None
    retrieval_query: str | None = None
    sources: list[SourceCitation] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ConversationDetail(BaseModel):
    workspace_id: str
    conversation_id: str
    conversation_title: str
    created_at: datetime
    updated_at: datetime
    messages: list[StoredMessage]
