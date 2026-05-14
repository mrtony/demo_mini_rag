from datetime import datetime

from pydantic import BaseModel, Field


class ChatStreamRequest(BaseModel):
    conversation_id: str | int = Field(default=0)
    message_id: int = 0
    message: str = Field(min_length=1)


class ConversationSummary(BaseModel):
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
    conversation_id: str
    conversation_title: str
    created_at: datetime
    updated_at: datetime
    messages: list[StoredMessage]
