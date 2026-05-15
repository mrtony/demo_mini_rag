from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class ChatStreamRequest(BaseModel):
    workspace_id: str | None = None
    conversation_id: str | int = Field(default=0)
    message_id: int = 0
    message: str = Field(min_length=1)


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


class WorkspaceSummary(BaseModel):
    workspace_id: str
    name: str
    system_message: str
    selected_model: ModelCatalogSummary
    model_settings: dict[str, Any]
    created_at: datetime
    updated_at: datetime


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
    created_at: datetime
    updated_at: datetime


class ConversationDetail(BaseModel):
    workspace_id: str
    conversation_id: str
    conversation_title: str
    created_at: datetime
    updated_at: datetime
    messages: list[StoredMessage]
