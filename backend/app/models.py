from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class ModelCatalog(Base):
    __tablename__ = "model_catalog"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(50), default="openai")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default_workspace_model: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_system_message: Mapped[bool] = mapped_column(Boolean, default=True)
    settings_schema_json: Mapped[str] = mapped_column(Text, default="{}")
    settings_defaults_json: Mapped[str] = mapped_column(Text, default="{}")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    workspaces: Mapped[list["Workspace"]] = relationship(back_populates="selected_model")


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    system_message: Mapped[str] = mapped_column(Text)
    selected_model_fk: Mapped[int] = mapped_column(ForeignKey("model_catalog.id"), index=True)
    active_knowledge_base_version_fk: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_base_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    selected_model: Mapped[ModelCatalog] = relationship(back_populates="workspaces", lazy="selectin")
    model_settings: Mapped[list["WorkspaceModelSetting"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
        order_by="WorkspaceModelSetting.setting_key",
        lazy="selectin",
    )
    knowledge_base_setting: Mapped["WorkspaceKnowledgeBaseSetting | None"] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
    )
    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    knowledge_base_jobs: Mapped[list["KnowledgeBaseJob"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    knowledge_documents: Mapped[list["KnowledgeDocument"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    knowledge_base_versions: Mapped[list["KnowledgeBaseVersion"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
        foreign_keys="KnowledgeBaseVersion.workspace_fk",
        order_by="KnowledgeBaseVersion.version_number",
        lazy="selectin",
    )
    active_knowledge_base_version: Mapped["KnowledgeBaseVersion | None"] = relationship(
        foreign_keys=[active_knowledge_base_version_fk],
        post_update=True,
        lazy="selectin",
    )


class WorkspaceModelSetting(Base):
    __tablename__ = "workspace_model_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_fk: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    setting_key: Mapped[str] = mapped_column(String(120), index=True)
    setting_value_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    workspace: Mapped[Workspace] = relationship(back_populates="model_settings", lazy="selectin")


class WorkspaceKnowledgeBaseSetting(Base):
    __tablename__ = "workspace_knowledge_base_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_fk: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    chunk_size: Mapped[int] = mapped_column(Integer, default=800)
    chunk_overlap: Mapped[int] = mapped_column(Integer, default=200)
    retrieval_top_k: Mapped[int] = mapped_column(Integer, default=8)
    similarity_threshold: Mapped[float] = mapped_column(Float, default=0.2)
    knowledge_answering_default: Mapped[bool] = mapped_column(Boolean, default=False)
    rebuild_required: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    workspace: Mapped[Workspace] = relationship(back_populates="knowledge_base_setting", lazy="selectin")


class KnowledgeBaseJob(Base):
    __tablename__ = "knowledge_base_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    workspace_fk: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    job_type: Mapped[str] = mapped_column(String(20), default="import")
    target_version_fk: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_base_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(20), default="queued")
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    workspace: Mapped["Workspace"] = relationship(back_populates="knowledge_base_jobs", lazy="selectin")
    target_version: Mapped["KnowledgeBaseVersion | None"] = relationship(
        back_populates="jobs",
        foreign_keys=[target_version_fk],
        lazy="selectin",
    )
    items: Mapped[list["KnowledgeBaseJobItem"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="KnowledgeBaseJobItem.id",
        lazy="selectin",
    )


class KnowledgeBaseVersion(Base):
    __tablename__ = "knowledge_base_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_fk: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    version_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    collection_name: Mapped[str] = mapped_column(String(255), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    workspace: Mapped["Workspace"] = relationship(
        back_populates="knowledge_base_versions",
        foreign_keys=[workspace_fk],
        lazy="selectin",
    )
    jobs: Mapped[list["KnowledgeBaseJob"]] = relationship(
        back_populates="target_version",
        foreign_keys="KnowledgeBaseJob.target_version_fk",
        lazy="selectin",
    )


class KnowledgeBaseJobItem(Base):
    __tablename__ = "knowledge_base_job_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    job_fk: Mapped[int] = mapped_column(
        ForeignKey("knowledge_base_jobs.id", ondelete="CASCADE"),
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    native_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    outcome: Mapped[str | None] = mapped_column(String(20), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    knowledge_document_fk: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    knowledge_document_revision_fk: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_document_revisions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    job: Mapped[KnowledgeBaseJob] = relationship(back_populates="items", lazy="selectin")
    knowledge_document: Mapped["KnowledgeDocument | None"] = relationship(
        back_populates="job_items",
        foreign_keys=[knowledge_document_fk],
        lazy="selectin",
    )
    knowledge_document_revision: Mapped["KnowledgeDocumentRevision | None"] = relationship(
        back_populates="job_items",
        foreign_keys=[knowledge_document_revision_fk],
        lazy="selectin",
    )


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_fk: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    knowledge_document_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    display_filename: Mapped[str] = mapped_column(String(255))
    current_revision_fk: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_document_revisions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    workspace: Mapped["Workspace"] = relationship(back_populates="knowledge_documents", lazy="selectin")
    revisions: Mapped[list["KnowledgeDocumentRevision"]] = relationship(
        back_populates="knowledge_document",
        cascade="all, delete-orphan",
        foreign_keys="KnowledgeDocumentRevision.knowledge_document_fk",
        order_by="KnowledgeDocumentRevision.revision_number",
        lazy="selectin",
    )
    current_revision: Mapped["KnowledgeDocumentRevision | None"] = relationship(
        foreign_keys=[current_revision_fk],
        post_update=True,
        lazy="selectin",
    )
    job_items: Mapped[list["KnowledgeBaseJobItem"]] = relationship(
        back_populates="knowledge_document",
        foreign_keys="KnowledgeBaseJobItem.knowledge_document_fk",
        lazy="selectin",
    )


class KnowledgeDocumentRevision(Base):
    __tablename__ = "knowledge_document_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    knowledge_document_fk: Mapped[int] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
        index=True,
    )
    revision_number: Mapped[int] = mapped_column(Integer, default=1)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    native_file_path: Mapped[str] = mapped_column(Text)
    normalized_markdown_text: Mapped[str] = mapped_column(Text)
    page_or_slide_map_json: Mapped[str] = mapped_column(Text, default="[]")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="completed")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    knowledge_document: Mapped["KnowledgeDocument"] = relationship(
        back_populates="revisions",
        foreign_keys=[knowledge_document_fk],
        lazy="selectin",
    )
    job_items: Mapped[list["KnowledgeBaseJobItem"]] = relationship(
        back_populates="knowledge_document_revision",
        foreign_keys="KnowledgeBaseJobItem.knowledge_document_revision_fk",
        lazy="selectin",
    )


class RetrievalTrace(Base):
    __tablename__ = "retrieval_traces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_fk: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    workspace_fk: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    knowledge_base_version_fk: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_base_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    fallback_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    retrieval_query_text: Mapped[str] = mapped_column(Text)
    retrieval_top_k: Mapped[int] = mapped_column(Integer, default=0)
    similarity_threshold: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    message: Mapped["Message"] = relationship(back_populates="retrieval_trace", lazy="selectin")
    sources: Mapped[list["RetrievalTraceSource"]] = relationship(
        back_populates="retrieval_trace",
        cascade="all, delete-orphan",
        order_by="RetrievalTraceSource.id",
        lazy="selectin",
    )


class RetrievalTraceSource(Base):
    __tablename__ = "retrieval_trace_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    retrieval_trace_fk: Mapped[int] = mapped_column(
        ForeignKey("retrieval_traces.id", ondelete="CASCADE"),
        index=True,
    )
    knowledge_document_fk: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    knowledge_document_revision_fk: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_document_revisions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    slide_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    citation_snapshot_text: Mapped[str] = mapped_column(Text)
    display_filename: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    retrieval_trace: Mapped[RetrievalTrace] = relationship(back_populates="sources", lazy="selectin")
    knowledge_document: Mapped["KnowledgeDocument | None"] = relationship(lazy="selectin")
    knowledge_document_revision: Mapped["KnowledgeDocumentRevision | None"] = relationship(lazy="selectin")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    workspace_fk: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    conversation_title: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    workspace: Mapped[Workspace] = relationship(back_populates="conversations", lazy="selectin")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.id",
        lazy="selectin",
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_fk: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"),
        index=True,
    )
    query: Mapped[str] = mapped_column(Text)
    response: Mapped[str] = mapped_column(Text, default="")
    openai_response_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="streaming")
    knowledge_answering_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    knowledge_answering_used: Mapped[bool] = mapped_column(Boolean, default=False)
    fallback_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    retrieval_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages", lazy="selectin")
    retrieval_trace: Mapped["RetrievalTrace | None"] = relationship(
        back_populates="message",
        cascade="all, delete-orphan",
        uselist=False,
        lazy="selectin",
    )
