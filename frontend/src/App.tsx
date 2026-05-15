import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import "./App.css";
import {
  createWorkspace,
  getConversation,
  listWorkspaceConversations,
  listWorkspaces,
  openChatStream,
  stopConversation,
  toChatBubbles,
} from "./api";
import { PlusIcon, SendIcon, StopIcon } from "./components/Icons";
import { readSseStream } from "./lib/sse";
import type { ChatBubble, ConversationSummary, ParsedSseEvent, WorkspaceSummary } from "./types";


const EMPTY_TITLE = "\u65b0\u5c0d\u8a71";


function createLocalBubble(role: ChatBubble["role"], content: string, status: ChatBubble["status"]): ChatBubble {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${role}-${Date.now()}-${Math.random()}`;
  return {
    id: randomId,
    role,
    content,
    status,
  };
}


function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}


function sortConversations(conversations: ConversationSummary[]): ConversationSummary[] {
  return [...conversations].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}


export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [conversationSummariesByWorkspaceId, setConversationSummariesByWorkspaceId] = useState<
    Record<string, ConversationSummary[]>
  >({});
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeAssistantBubbleRef = useRef<string | null>(null);
  const stopRequestedBubbleRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshWorkspaces();
  }, []);

  useEffect(() => {
    if (activeWorkspaceId === null) {
      setActiveConversationId(null);
      setMessages([]);
      return;
    }
    void refreshWorkspaceConversations(activeWorkspaceId);
  }, [activeWorkspaceId]);

  async function refreshWorkspaces(preferredWorkspaceId?: string) {
    try {
      const data = await listWorkspaces();
      setWorkspaces(data);
      setActiveWorkspaceId((current) => {
        if (preferredWorkspaceId && data.some((item) => item.workspace_id === preferredWorkspaceId)) {
          return preferredWorkspaceId;
        }
        if (current && data.some((item) => item.workspace_id === current)) {
          return current;
        }
        return data[0]?.workspace_id ?? null;
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshWorkspaceConversations(workspaceId: string) {
    try {
      const data = await listWorkspaceConversations(workspaceId);
      setConversationSummariesByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: data,
      }));
      setActiveConversationId((currentConversationId) => {
        if (currentConversationId && data.some((item) => item.conversation_id === currentConversationId)) {
          return currentConversationId;
        }
        setMessages([]);
        return null;
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function loadConversation(conversationId: string) {
    try {
      setErrorMessage(null);
      const detail = await getConversation(conversationId);
      setActiveWorkspaceId(detail.workspace_id);
      setActiveConversationId(detail.conversation_id);
      setMessages(toChatBubbles(detail.messages));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newWorkspaceName.trim();
    if (!trimmed) {
      return;
    }

    try {
      setErrorMessage(null);
      const createdWorkspace = await createWorkspace(trimmed);
      setWorkspaces((current) => [...current, createdWorkspace]);
      setConversationSummariesByWorkspaceId((current) => ({
        ...current,
        [createdWorkspace.workspace_id]: [],
      }));
      setActiveWorkspaceId(createdWorkspace.workspace_id);
      setActiveConversationId(null);
      setMessages([]);
      setDraft("");
      setNewWorkspaceName("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function startNewConversation() {
    if (isStreaming || activeWorkspaceId === null) {
      return;
    }
    setActiveConversationId(null);
    setMessages([]);
    setDraft("");
    setErrorMessage(null);
  }

  function selectWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) {
      return;
    }
    setActiveWorkspaceId(workspaceId);
    setActiveConversationId(null);
    setMessages([]);
    setDraft("");
    setErrorMessage(null);
  }

  function upsertConversation(workspaceId: string, conversation: ConversationSummary) {
    setConversationSummariesByWorkspaceId((current) => {
      const existing = current[workspaceId] ?? [];
      const next = [...existing];
      const existingIndex = next.findIndex((item) => item.conversation_id === conversation.conversation_id);
      if (existingIndex >= 0) {
        next[existingIndex] = conversation;
      } else {
        next.unshift(conversation);
      }
      return {
        ...current,
        [workspaceId]: sortConversations(next),
      };
    });
  }

  function updateBubble(targetBubbleId: string | null, updater: (bubble: ChatBubble) => ChatBubble) {
    if (targetBubbleId === null) {
      return;
    }
    setMessages((current) => current.map((item) => (item.id === targetBubbleId ? updater(item) : item)));
  }

  function handleStreamEvent(event: ParsedSseEvent) {
    const targetBubbleId = activeAssistantBubbleRef.current;

    if (event.event === "conversation.created") {
      const workspaceId = String(event.data.workspace_id);
      const conversationId = String(event.data.conversation_id);
      const title = String(event.data.conversation_title ?? EMPTY_TITLE);
      const now = new Date().toISOString();
      setActiveWorkspaceId(workspaceId);
      setActiveConversationId(conversationId);
      upsertConversation(workspaceId, {
        workspace_id: workspaceId,
        conversation_id: conversationId,
        conversation_title: title,
        updated_at: now,
      });
      return;
    }

    if (event.event === "conversation.title") {
      const workspaceId = String(event.data.workspace_id);
      const conversationId = String(event.data.conversation_id);
      const title = String(event.data.conversation_title ?? EMPTY_TITLE);
      const updatedAt = String(event.data.updated_at ?? new Date().toISOString());
      upsertConversation(workspaceId, {
        workspace_id: workspaceId,
        conversation_id: conversationId,
        conversation_title: title,
        updated_at: updatedAt,
      });
      return;
    }

    if (event.event === "message.created") {
      const messageId = Number(event.data.message_id);
      updateBubble(targetBubbleId, (item) => ({
        ...item,
        messageId,
      }));
      return;
    }

    if (event.event === "message.delta") {
      const delta = String(event.data.delta ?? "");
      updateBubble(targetBubbleId, (item) => ({
        ...item,
        content: item.content + delta,
        status: stopRequestedBubbleRef.current === item.id || item.status === "stopped" ? "stopped" : "streaming",
      }));
      return;
    }

    if (event.event === "message.done") {
      const status = event.data.status;
      const nextStatus: ChatBubble["status"] =
        status === "completed" || status === "stopped" || status === "error" ? status : "completed";
      updateBubble(targetBubbleId, (item) => ({
        ...item,
        status:
          stopRequestedBubbleRef.current === item.id && nextStatus !== "error"
            ? "stopped"
            : item.status === "stopped" && nextStatus === "completed"
              ? "stopped"
              : nextStatus,
      }));
      return;
    }

    if (event.event === "error") {
      setErrorMessage(String(event.data.message ?? "Streaming failed"));
      updateBubble(targetBubbleId, (item) => ({
        ...item,
        status: stopRequestedBubbleRef.current === item.id ? "stopped" : "error",
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isStreaming || activeWorkspaceId === null) {
      return;
    }

    setErrorMessage(null);
    setDraft("");

    const userBubble = createLocalBubble("user", trimmed, "completed");
    const assistantBubble = createLocalBubble("assistant", "", "streaming");
    activeAssistantBubbleRef.current = assistantBubble.id;
    stopRequestedBubbleRef.current = null;
    setMessages((current) => [...current, userBubble, assistantBubble]);

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);

    try {
      const response = await openChatStream(
        {
          workspace_id: activeWorkspaceId,
          conversation_id: activeConversationId ?? 0,
          message_id: 0,
          message: trimmed,
        },
        controller.signal,
      );

      await readSseStream(response.body!, handleStreamEvent, controller.signal);
    } catch (error) {
      if (isAbortError(error)) {
        updateBubble(stopRequestedBubbleRef.current, (item) => ({
          ...item,
          status: "stopped",
        }));
      } else {
        setErrorMessage(getErrorMessage(error));
        updateBubble(activeAssistantBubbleRef.current, (item) => ({
          ...item,
          status: "error",
        }));
      }
    } finally {
      const stoppedBubbleId = stopRequestedBubbleRef.current;
      updateBubble(stoppedBubbleId, (item) => ({
        ...item,
        status: item.status === "error" ? item.status : "stopped",
      }));
      abortRef.current = null;
      setIsStreaming(false);
      activeAssistantBubbleRef.current = null;
      stopRequestedBubbleRef.current = null;
      if (activeWorkspaceId !== null) {
        void refreshWorkspaceConversations(activeWorkspaceId);
      }
    }
  }

  async function stopStreaming() {
    const targetConversationId = activeConversationId;
    const targetAssistantBubbleId = activeAssistantBubbleRef.current;
    stopRequestedBubbleRef.current = targetAssistantBubbleId;

    updateBubble(targetAssistantBubbleId, (item) => ({
      ...item,
      status: "stopped",
    }));

    if (targetConversationId) {
      try {
        await stopConversation(targetConversationId);
      } catch {
        // Best effort server-side cancellation; still abort the client stream below.
      }
    }
    abortRef.current?.abort();
  }

  const activeWorkspace = workspaces.find((item) => item.workspace_id === activeWorkspaceId) ?? null;
  const visibleConversations = activeWorkspaceId ? conversationSummariesByWorkspaceId[activeWorkspaceId] ?? [] : [];
  const activeTitle =
    visibleConversations.find((item) => item.conversation_id === activeConversationId)?.conversation_title ??
    EMPTY_TITLE;
  const showSendButton = !isStreaming && draft.trim().length > 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <h1 className="sidebar-title">{"\u5de5\u4f5c\u5340"}</h1>
            <p className="sidebar-subtitle">Workspace-owned chat</p>
          </div>
        </div>

        <form className="composer-form" onSubmit={handleCreateWorkspace}>
          <textarea
            value={newWorkspaceName}
            onChange={(nextEvent) => setNewWorkspaceName(nextEvent.target.value)}
            placeholder={"\u8f38\u5165\u5de5\u4f5c\u5340\u540d\u7a31"}
            aria-label={"\u5de5\u4f5c\u5340\u540d\u7a31"}
          />
          <div className="composer-actions">
            <button type="submit" className="icon-button" aria-label={"\u5efa\u7acb\u5de5\u4f5c\u5340"}>
              <PlusIcon />
            </button>
          </div>
        </form>

        <div className="conversation-list">
          {workspaces.map((workspace) => (
            <button
              key={workspace.workspace_id}
              type="button"
              className={`conversation-item${workspace.workspace_id === activeWorkspaceId ? " active" : ""}`}
              onClick={() => selectWorkspace(workspace.workspace_id)}
            >
              <strong>{workspace.name}</strong>
              <span>{workspace.selected_model.label}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-header">
          <div>
            <h2 className="sidebar-title">{"\u5c0d\u8a71"}</h2>
            <p className="sidebar-subtitle">
              {activeWorkspace ? activeWorkspace.name : "\u5148\u5efa\u7acb\u6216\u9078\u64c7\u5de5\u4f5c\u5340"}
            </p>
          </div>
          <button
            type="button"
            className="new-chat-button"
            onClick={startNewConversation}
            aria-label={"\u65b0\u589e\u5c0d\u8a71"}
            title={"\u65b0\u589e\u5c0d\u8a71"}
            disabled={activeWorkspaceId === null || isStreaming}
          >
            <PlusIcon />
          </button>
        </div>

        <div className="conversation-list">
          {visibleConversations.map((conversation) => (
            <button
              key={conversation.conversation_id}
              type="button"
              className={`conversation-item${
                conversation.conversation_id === activeConversationId ? " active" : ""
              }`}
              onClick={() => void loadConversation(conversation.conversation_id)}
            >
              <strong>{conversation.conversation_title}</strong>
              <span>{formatTime(conversation.updated_at)}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel">
        <div className="chat-header">
          <h2>{activeTitle}</h2>
          <p>
            {activeWorkspace
              ? `${activeWorkspace.name} | ${activeWorkspace.selected_model.label}`
              : "Create a Workspace before starting a Conversation."}
          </p>
        </div>

        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

        <section className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <h3>
                {activeWorkspace
                  ? "\u958b\u59cb\u4e00\u6bb5\u65b0\u5c0d\u8a71"
                  : "\u5148\u5efa\u7acb\u5de5\u4f5c\u5340"}
              </h3>
              <p>
                {activeWorkspace
                  ? "\u7b2c\u4e00\u53e5 User Prompt \u9001\u51fa\u5f8c\u624d\u6703\u5728\u9019\u500b Workspace \u5efa\u7acb Conversation\u3002"
                  : "\u5de6\u5074\u8f38\u5165 Workspace Name \u4e26\u5efa\u7acb\uff0c\u518d\u958b\u59cb\u5c0d\u8a71\u3002"}
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`message-row ${message.role}`}>
                <div className={`message-bubble ${message.status === "streaming" ? "streaming" : ""}`}>
                  <div>{message.content || (message.status === "streaming" ? " " : "")}</div>
                  {message.status === "stopped" ? (
                    <div className="message-status">{"\u5df2\u4e2d\u65b7"}</div>
                  ) : null}
                  {message.status === "error" ? (
                    <div className="message-status">{"\u767c\u751f\u932f\u8aa4"}</div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </section>

        <div className="composer">
          <form className="composer-form" onSubmit={handleSubmit}>
            <textarea
              value={draft}
              onChange={(nextEvent) => setDraft(nextEvent.target.value)}
              placeholder={
                activeWorkspace ? "\u8f38\u5165\u8a0a\u606f..." : "\u5148\u5efa\u7acb\u6216\u9078\u64c7\u5de5\u4f5c\u5340"
              }
              aria-label={"\u8a0a\u606f\u8f38\u5165\u6846"}
              disabled={activeWorkspaceId === null}
            />

            <div className="composer-actions">
              {isStreaming ? (
                <button
                  type="button"
                  className="icon-button stop"
                  onClick={() => void stopStreaming()}
                  aria-label="Stop response"
                >
                  <StopIcon />
                </button>
              ) : null}

              {showSendButton ? (
                <button type="submit" className="icon-button" aria-label="Send message">
                  <SendIcon />
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}


function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}


function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
