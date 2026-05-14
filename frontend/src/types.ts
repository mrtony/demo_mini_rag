export type ConversationSummary = {
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
  conversation_id: string | number;
  message_id: number;
  message: string;
};

export type ParsedSseEvent = {
  event: string;
  data: Record<string, unknown>;
};
