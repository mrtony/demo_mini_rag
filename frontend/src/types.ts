export type ModelCatalogSummary = {
  model_id: string;
  label: string;
  is_enabled: boolean;
  is_default_workspace_model: boolean;
};

export type ModelSettingOption = {
  value: string;
  label: string;
};

export type ModelSettingSchema = {
  type: "number" | "enum";
  label: string;
  help_text?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: ModelSettingOption[];
};

export type ModelCatalogEntry = ModelCatalogSummary & {
  supports_system_message: boolean;
  settings_schema: Record<string, ModelSettingSchema>;
  settings_defaults: Record<string, string | number>;
  sort_order: number;
};

export type WorkspaceSummary = {
  workspace_id: string;
  name: string;
  system_message: string;
  selected_model: ModelCatalogSummary;
  model_settings?: Record<string, string | number>;
  sort_order?: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeBaseSettings = {
  workspace_id: string;
  chunk_size: number;
  chunk_overlap: number;
  retrieval_top_k: number;
  similarity_threshold: number;
  knowledge_answering_default: boolean;
  rebuild_required: boolean;
};

export type KnowledgeBaseJobItem = {
  item_id: string;
  filename: string;
  status: string;
  outcome: string | null;
  error_message: string | null;
};

export type KnowledgeBaseJob = {
  job_id: string;
  workspace_id: string;
  job_type?: "import" | "rebuild";
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  file_count: number;
  created_at: string;
  items?: KnowledgeBaseJobItem[];
  completed_at: string | null;
};

export type KnowledgeBaseJobList = {
  active: KnowledgeBaseJob[];
  history: KnowledgeBaseJob[];
  history_total: number;
  history_page: number;
};

export type KnowledgeDocument = {
  knowledge_document_id: string;
  display_filename: string;
  revision_number: number;
  chunk_count: number;
  locator_summary: string[];
  created_at: string;
  updated_at: string;
};

export type KnowledgeDocumentList = {
  documents: KnowledgeDocument[];
};

export type ConversationSummary = {
  workspace_id: string;
  conversation_id: string;
  conversation_title: string;
  updated_at: string;
};

export type StoredMessage = {
  id: number;
  query: string;
  response: string;
  status: string;
  knowledge_answering_requested?: boolean;
  knowledge_answering_used?: boolean;
  fallback_reason?: string | null;
  retrieval_query?: string | null;
  sources?: SourceCitation[];
  created_at: string;
  updated_at: string;
};

export type SourceCitation = {
  knowledge_document_id: string;
  display_filename: string;
  revision_number: number;
  chunk_count: number;
  excerpt: string;
  score: number;
};

export type ConversationDetail = {
  workspace_id: string;
  conversation_id: string;
  conversation_title: string;
  created_at: string;
  updated_at: string;
  messages: StoredMessage[];
};

export type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "completed" | "stopped" | "error";
  messageId?: number;
  knowledgeAnsweringRequested?: boolean;
  knowledgeAnsweringUsed?: boolean;
  fallbackReason?: string | null;
  sources?: SourceCitation[];
};

export type ChatStreamRequest = {
  workspace_id: string;
  conversation_id: string | number;
  message_id: number;
  message: string;
  knowledge_answering_enabled?: boolean;
};

export type ParsedSseEvent = {
  event: string;
  data: Record<string, unknown>;
};
