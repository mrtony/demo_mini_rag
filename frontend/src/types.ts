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
  created_at: string;
  updated_at: string;
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
};

export type ChatStreamRequest = {
  workspace_id: string;
  conversation_id: string | number;
  message_id: number;
  message: string;
};

export type ParsedSseEvent = {
  event: string;
  data: Record<string, unknown>;
};
