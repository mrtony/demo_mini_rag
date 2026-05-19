import type {
  ChatBubble,
  ChatStreamRequest,
  ConversationDetail,
  ConversationSummary,
  KnowledgeBaseJob,
  KnowledgeBaseJobList,
  KnowledgeDocumentList,
  KnowledgeBaseSettings,
  ModelCatalogEntry,
  ModelCatalogSummary,
  StoredMessage,
  WorkspaceSummary,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
        message = payload.detail;
      }
    } catch {
      // Ignore JSON parsing failures and keep the status-based message.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function createImportJob(workspaceId: string, files: File[]): Promise<KnowledgeBaseJob> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/knowledge-base/import`, {
    method: "POST",
    body: formData,
  });
  return expectJson<KnowledgeBaseJob>(response);
}

export async function createRebuildJob(workspaceId: string): Promise<KnowledgeBaseJob> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/knowledge-base/rebuild`, {
    method: "POST",
  });
  return expectJson<KnowledgeBaseJob>(response);
}

export async function listKnowledgeBaseJobs(
  workspaceId: string,
  historyPage = 1,
): Promise<KnowledgeBaseJobList> {
  const response = await fetch(
    `${API_BASE}/api/workspaces/${workspaceId}/knowledge-base/jobs?history_page=${historyPage}`,
  );
  return expectJson<KnowledgeBaseJobList>(response);
}

export async function cancelImportJob(workspaceId: string, jobId: string): Promise<KnowledgeBaseJob> {
  const response = await fetch(
    `${API_BASE}/api/workspaces/${workspaceId}/knowledge-base/jobs/${jobId}/cancel`,
    { method: "POST" },
  );
  return expectJson<KnowledgeBaseJob>(response);
}

export async function listKnowledgeBaseDocuments(workspaceId: string): Promise<KnowledgeDocumentList> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/knowledge-base/documents`);
  return expectJson<KnowledgeDocumentList>(response);
}

export async function deleteKnowledgeBaseDocument(workspaceId: string, knowledgeDocumentId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/workspaces/${workspaceId}/knowledge-base/documents/${knowledgeDocumentId}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    await expectJson<Record<string, never>>(response);
  }
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const response = await fetch(`${API_BASE}/api/workspaces`);
  return expectJson<WorkspaceSummary[]>(response);
}

export async function listArchivedWorkspaces(): Promise<WorkspaceSummary[]> {
  const response = await fetch(`${API_BASE}/api/workspaces/archived`);
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

export async function updateWorkspace(
  workspaceId: string,
  payload: {
    name: string;
    system_message: string;
    selected_model_id: string;
    model_settings: Record<string, string | number>;
  },
): Promise<WorkspaceSummary> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return expectJson<WorkspaceSummary>(response);
}

export async function getKnowledgeBaseSettings(workspaceId: string): Promise<KnowledgeBaseSettings> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/knowledge-base-settings`);
  return expectJson<KnowledgeBaseSettings>(response);
}

export async function updateKnowledgeBaseSettings(
  workspaceId: string,
  payload: {
    chunk_size: number;
    chunk_overlap: number;
    retrieval_top_k: number;
    similarity_threshold: number;
    knowledge_answering_default: boolean;
  },
): Promise<KnowledgeBaseSettings> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/knowledge-base-settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return expectJson<KnowledgeBaseSettings>(response);
}

export async function reorderWorkspaces(workspaceIds: string[]): Promise<WorkspaceSummary[]> {
  const response = await fetch(`${API_BASE}/api/workspaces/reorder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspace_ids: workspaceIds }),
  });
  return expectJson<WorkspaceSummary[]>(response);
}

export async function archiveWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/archive`, {
    method: "POST",
  });
  return expectJson<WorkspaceSummary>(response);
}

export async function restoreWorkspace(workspaceId: string): Promise<WorkspaceSummary> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/restore`, {
    method: "POST",
  });
  return expectJson<WorkspaceSummary>(response);
}

export async function getDefaultWorkspaceModel(): Promise<ModelCatalogSummary> {
  const response = await fetch(`${API_BASE}/api/workspaces/default-model`);
  return expectJson<ModelCatalogSummary>(response);
}

export async function listModels(): Promise<ModelCatalogEntry[]> {
  const response = await fetch(`${API_BASE}/api/models`);
  return expectJson<ModelCatalogEntry[]>(response);
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
    let message = `Streaming request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
        message = payload.detail;
      }
    } catch {
      // Ignore JSON parsing failures and keep the status-based message.
    }
    throw new Error(message);
  }
  return response;
}

export async function stopConversation(conversationId: string): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${conversationId}/stop`, {
    method: "POST",
  });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
        message = payload.detail;
      }
    } catch {
      // Ignore JSON parsing failures and keep the status-based message.
    }
    throw new Error(message);
  }
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
