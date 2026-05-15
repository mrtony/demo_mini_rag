import type {
  ChatBubble,
  ChatStreamRequest,
  ConversationDetail,
  ConversationSummary,
  StoredMessage,
  WorkspaceSummary,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const response = await fetch(`${API_BASE}/api/workspaces`);
  return expectJson<WorkspaceSummary[]>(response);
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const response = await fetch(`${API_BASE}/api/workspaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  return expectJson<WorkspaceSummary>(response);
}

export async function listWorkspaceConversations(workspaceId: string): Promise<ConversationSummary[]> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/conversations`);
  return expectJson<ConversationSummary[]>(response);
}

export async function getConversation(conversationId: string): Promise<ConversationDetail> {
  const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
  return expectJson<ConversationDetail>(response);
}

export async function openChatStream(
  payload: ChatStreamRequest,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || response.body === null) {
    throw new Error(`Streaming request failed with status ${response.status}`);
  }
  return response;
}

export async function stopConversation(conversationId: string): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${conversationId}/stop`, {
    method: "POST",
  });
}

export function toChatBubbles(messages: StoredMessage[]): ChatBubble[] {
  return messages.flatMap((message) => [
    {
      id: `user-${message.id}`,
      role: "user",
      content: message.query,
      status: "completed",
      messageId: message.id,
    },
    {
      id: `assistant-${message.id}`,
      role: "assistant",
      content: message.response,
      status: normalizeStatus(message.status),
      messageId: message.id,
    },
  ]);
}

function normalizeStatus(status: string): ChatBubble["status"] {
  if (status === "completed" || status === "stopped" || status === "error") {
    return status;
  }
  return "streaming";
}
