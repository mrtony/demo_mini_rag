import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import "./App.css";
import {
  archiveWorkspace,
  createWorkspace,
  deleteConversation,
  getDefaultWorkspaceModel,
  getConversation,
  listArchivedWorkspaces,
  listModels,
  listWorkspaceConversations,
  listWorkspaces,
  openChatStream,
  reorderWorkspaces,
  restoreWorkspace,
  stopConversation,
  toChatBubbles,
  updateWorkspace,
} from "./api";
import { PlusIcon, SendIcon, StopIcon } from "./components/Icons";
import { readSseStream } from "./lib/sse";
import type {
  ChatBubble,
  ConversationSummary,
  ModelCatalogEntry,
  ModelSettingSchema,
  ModelCatalogSummary,
  ParsedSseEvent,
  WorkspaceSummary,
} from "./types";


const EMPTY_TITLE = "\u65b0\u5c0d\u8a71";

type WorkspaceSettingsDraft = {
  workspaceId: string;
  name: string;
  systemMessage: string;
  selectedModelId: string;
  modelSettings: Record<string, string | number>;
};

type SettingsValidationErrors = {
  name?: string;
  systemMessage?: string;
  selectedModelId?: string;
  modelSettings: Record<string, string>;
};

type ConversationMessagesById = Record<string, ChatBubble[]>;


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


function sortWorkspaces(workspaces: WorkspaceSummary[]): WorkspaceSummary[] {
  return [...workspaces].sort((left, right) => {
    const leftOrder = left.sort_order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}


function createSettingsDraft(workspace: WorkspaceSummary): WorkspaceSettingsDraft {
  return {
    workspaceId: workspace.workspace_id,
    name: workspace.name,
    systemMessage: workspace.system_message,
    selectedModelId: workspace.selected_model.model_id,
    modelSettings: { ...(workspace.model_settings ?? {}) },
  };
}

function normalizeModelSettings(
  settings: Record<string, string | number> | undefined,
): Record<string, string | number> {
  if (!settings) {
    return {};
  }
  return Object.keys(settings)
    .sort()
    .reduce<Record<string, string | number>>((accumulator, key) => {
      accumulator[key] = settings[key];
      return accumulator;
    }, {});
}


function createModelSettingsForModel(
  model: ModelCatalogEntry | null,
  currentSettings: Record<string, string | number>,
): Record<string, string | number> {
  if (model === null) {
    return {};
  }

  return Object.keys(model.settings_schema).reduce<Record<string, string | number>>((accumulator, key) => {
    if (key in currentSettings) {
      accumulator[key] = currentSettings[key]!;
      return accumulator;
    }
    const defaultValue = model.settings_defaults[key];
    if (typeof defaultValue === "string" || typeof defaultValue === "number") {
      accumulator[key] = defaultValue;
    }
    return accumulator;
  }, {});
}


function getSettingsValidationErrors(
  draft: WorkspaceSettingsDraft | null,
  modelCatalog: ModelCatalogEntry[],
): SettingsValidationErrors {
  if (draft === null) {
    return { modelSettings: {} };
  }

  const selectedModel = modelCatalog.find((item) => item.model_id === draft.selectedModelId) ?? null;
  const errors: SettingsValidationErrors = { modelSettings: {} };
  if (draft.name.trim().length < 3) {
    errors.name = "Workspace Name must be at least three characters long";
  }
  if (draft.systemMessage.trim().length === 0) {
    errors.systemMessage = "System Message cannot be blank";
  }
  if (!draft.selectedModelId.trim()) {
    errors.selectedModelId = "Selected Model is required";
  }
  if (selectedModel === null) {
    return errors;
  }

  Object.entries(selectedModel.settings_schema).forEach(([settingKey, schema]) => {
    const value = draft.modelSettings[settingKey];
    if (schema.type === "number") {
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.modelSettings[settingKey] = `${schema.label} must be a number`;
        return;
      }
      if (typeof schema.min === "number" && value < schema.min) {
        errors.modelSettings[settingKey] = `${schema.label} must be at least ${schema.min}`;
        return;
      }
      if (typeof schema.max === "number" && value > schema.max) {
        errors.modelSettings[settingKey] = `${schema.label} must be at most ${schema.max}`;
      }
      return;
    }

    const allowedValues = new Set((schema.options ?? []).map((option) => option.value));
    if (typeof value !== "string" || !allowedValues.has(value)) {
      errors.modelSettings[settingKey] = `${schema.label} is not supported by the Selected Model`;
    }
  });
  return errors;
}


function hasValidationErrors(errors: SettingsValidationErrors): boolean {
  return Boolean(
    errors.name ||
      errors.systemMessage ||
      errors.selectedModelId ||
      Object.keys(errors.modelSettings).length > 0,
  );
}


export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [archivedWorkspaces, setArchivedWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [defaultWorkspaceModel, setDefaultWorkspaceModel] = useState<ModelCatalogSummary | null>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogEntry[]>([]);
  const [conversationSummariesByWorkspaceId, setConversationSummariesByWorkspaceId] = useState<
    Record<string, ConversationSummary[]>
  >({});
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationMessagesById, setConversationMessagesById] = useState<ConversationMessagesById>({});
  const [pendingConversationMessages, setPendingConversationMessages] = useState<ChatBubble[]>([]);
  const [pendingConversationWorkspaceId, setPendingConversationWorkspaceId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isStreamInFlight, setIsStreamInFlight] = useState(false);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<WorkspaceSettingsDraft | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"general" | "model">("general");
  const abortRef = useRef<AbortController | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const pendingConversationWorkspaceIdRef = useRef<string | null>(null);
  const pendingConversationMessagesRef = useRef<ChatBubble[]>([]);
  const streamConversationIdRef = useRef<string | null>(null);
  const streamWorkspaceIdRef = useRef<string | null>(null);
  const activeAssistantBubbleRef = useRef<string | null>(null);
  const stopRequestedBubbleRef = useRef<string | null>(null);

  useEffect(() => {
    void refreshWorkspaces();
    void refreshArchivedWorkspaces();
    void refreshDefaultWorkspaceModel();
    void refreshModelCatalog();
  }, []);

  useEffect(() => {
    if (activeWorkspaceId === null) {
      setActiveConversationId(null);
      setIsSettingsOpen(false);
      setSettingsDraft(null);
      setActiveSettingsTab("general");
      return;
    }
    void refreshWorkspaceConversations(activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    pendingConversationWorkspaceIdRef.current = pendingConversationWorkspaceId;
  }, [pendingConversationWorkspaceId]);

  function setPendingConversationState(workspaceId: string | null, messages: ChatBubble[]) {
    pendingConversationMessagesRef.current = messages;
    setPendingConversationWorkspaceId(workspaceId);
    setPendingConversationMessages(messages);
  }

  function replaceConversationMessages(conversationId: string, messages: ChatBubble[]) {
    setConversationMessagesById((current) => ({
      ...current,
      [conversationId]: messages,
    }));
  }

  function appendConversationBubbles(conversationId: string, bubbles: ChatBubble[]) {
    setConversationMessagesById((current) => ({
      ...current,
      [conversationId]: [...(current[conversationId] ?? []), ...bubbles],
    }));
  }

  function updatePendingBubble(targetBubbleId: string | null, updater: (bubble: ChatBubble) => ChatBubble) {
    if (targetBubbleId === null) {
      return;
    }
    setPendingConversationMessages((current) => {
      const nextMessages = current.map((item) => (item.id === targetBubbleId ? updater(item) : item));
      pendingConversationMessagesRef.current = nextMessages;
      return nextMessages;
    });
  }

  function updateConversationBubble(
    conversationId: string,
    targetBubbleId: string | null,
    updater: (bubble: ChatBubble) => ChatBubble,
  ) {
    if (targetBubbleId === null) {
      return;
    }
    setConversationMessagesById((current) => ({
      ...current,
      [conversationId]: (current[conversationId] ?? []).map((item) =>
        item.id === targetBubbleId ? updater(item) : item,
      ),
    }));
  }

  function updateStreamBubble(targetBubbleId: string | null, updater: (bubble: ChatBubble) => ChatBubble) {
    const conversationId = streamConversationIdRef.current;
    if (conversationId === null) {
      updatePendingBubble(targetBubbleId, updater);
      return;
    }
    updateConversationBubble(conversationId, targetBubbleId, updater);
  }

  async function refreshWorkspaces(preferredWorkspaceId?: string) {
    try {
      const data = await listWorkspaces();
      setWorkspaces(sortWorkspaces(data));
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

  async function refreshArchivedWorkspaces() {
    try {
      const data = await listArchivedWorkspaces();
      setArchivedWorkspaces(sortWorkspaces(data));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshDefaultWorkspaceModel() {
    try {
      const data = await getDefaultWorkspaceModel();
      setDefaultWorkspaceModel(data);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshModelCatalog() {
    try {
      const data = await listModels();
      setModelCatalog(data);
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
        return null;
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function loadConversation(conversationId: string) {
    if (!canLeaveSettingsView()) {
      return;
    }
    try {
      setErrorMessage(null);
      setIsSettingsOpen(false);
      setSettingsDraft(null);
      setActiveSettingsTab("general");
      setActiveConversationId(conversationId);

      if (streamingConversationId === conversationId && (conversationMessagesById[conversationId] ?? []).length > 0) {
        return;
      }

      const detail = await getConversation(conversationId);
      setActiveWorkspaceId(detail.workspace_id);
      setActiveConversationId(detail.conversation_id);
      replaceConversationMessages(detail.conversation_id, toChatBubbles(detail.messages));
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
      setWorkspaces((current) => sortWorkspaces([...current, createdWorkspace]));
      setConversationSummariesByWorkspaceId((current) => ({
        ...current,
        [createdWorkspace.workspace_id]: [],
      }));
      setActiveWorkspaceId(createdWorkspace.workspace_id);
      setActiveConversationId(null);
      setDraft("");
      setNewWorkspaceName("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function startNewConversation() {
    if (isStreamInFlight || activeWorkspaceId === null) {
      return;
    }
    if (!canLeaveSettingsView()) {
      return;
    }
    setIsSettingsOpen(false);
    setSettingsDraft(null);
    setActiveSettingsTab("general");
    setActiveConversationId(null);
    setDraft("");
    setErrorMessage(null);
  }

  function selectWorkspace(workspaceId: string) {
    if (workspaceId === activeWorkspaceId) {
      return;
    }
    if (!canLeaveSettingsView()) {
      return;
    }
    setIsSettingsOpen(false);
    setSettingsDraft(null);
    setActiveSettingsTab("general");
    setActiveWorkspaceId(workspaceId);
    setActiveConversationId(null);
    setDraft("");
    setErrorMessage(null);
  }

  async function handleArchiveWorkspace(workspaceId: string) {
    try {
      setErrorMessage(null);
      const archivedWorkspace = await archiveWorkspace(workspaceId);
      const remainingWorkspaces = workspaces.filter((item) => item.workspace_id !== workspaceId);
      setWorkspaces(sortWorkspaces(remainingWorkspaces));
      setArchivedWorkspaces((current) => sortWorkspaces([...current, archivedWorkspace]));

      if (activeWorkspaceId === workspaceId) {
        setIsSettingsOpen(false);
        setSettingsDraft(null);
        setActiveSettingsTab("general");
        setActiveWorkspaceId(remainingWorkspaces[0]?.workspace_id ?? null);
        setActiveConversationId(null);
        setDraft("");
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleRestoreWorkspace(workspaceId: string) {
    try {
      setErrorMessage(null);
      const restoredWorkspace = await restoreWorkspace(workspaceId);
      setArchivedWorkspaces((current) => current.filter((item) => item.workspace_id !== workspaceId));
      setWorkspaces((current) => sortWorkspaces([...current, restoredWorkspace]));
      setConversationSummariesByWorkspaceId((current) => ({
        ...current,
        [restoredWorkspace.workspace_id]: current[restoredWorkspace.workspace_id] ?? [],
      }));
      setActiveWorkspaceId(restoredWorkspace.workspace_id);
      setActiveConversationId(null);
      setDraft("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleMoveWorkspace(workspaceId: string, direction: -1 | 1) {
    const currentIndex = workspaces.findIndex((item) => item.workspace_id === workspaceId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= workspaces.length) {
      return;
    }

    const nextWorkspaces = [...workspaces];
    const [workspace] = nextWorkspaces.splice(currentIndex, 1);
    nextWorkspaces.splice(targetIndex, 0, workspace);

    try {
      setErrorMessage(null);
      const reordered = await reorderWorkspaces(nextWorkspaces.map((item) => item.workspace_id));
      setWorkspaces(sortWorkspaces(reordered));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
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

  function handleStreamEvent(event: ParsedSseEvent) {
    const targetBubbleId = activeAssistantBubbleRef.current;

    if (event.event === "conversation.created") {
      const workspaceId = String(event.data.workspace_id);
      const conversationId = String(event.data.conversation_id);
      const title = String(event.data.conversation_title ?? EMPTY_TITLE);
      const now = new Date().toISOString();
      const shouldOpenCreatedConversation =
        activeWorkspaceIdRef.current === workspaceId &&
        activeConversationIdRef.current === null &&
        pendingConversationWorkspaceIdRef.current === workspaceId;

      replaceConversationMessages(conversationId, pendingConversationMessagesRef.current);
      setPendingConversationState(null, []);
      streamConversationIdRef.current = conversationId;
      setStreamingConversationId(conversationId);

      if (shouldOpenCreatedConversation) {
        setActiveConversationId(conversationId);
      }
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
      updateStreamBubble(targetBubbleId, (item) => ({
        ...item,
        messageId,
      }));
      return;
    }

    if (event.event === "message.delta") {
      const delta = String(event.data.delta ?? "");
      updateStreamBubble(targetBubbleId, (item) => ({
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
      updateStreamBubble(targetBubbleId, (item) => ({
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
      updateStreamBubble(targetBubbleId, (item) => ({
        ...item,
        status: stopRequestedBubbleRef.current === item.id ? "stopped" : "error",
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (
      !trimmed ||
      isStreamInFlight ||
      activeWorkspaceId === null ||
      activeWorkspace?.selected_model.is_enabled === false
    ) {
      return;
    }

    setErrorMessage(null);
    setDraft("");

    const userBubble = createLocalBubble("user", trimmed, "completed");
    const assistantBubble = createLocalBubble("assistant", "", "streaming");
    activeAssistantBubbleRef.current = assistantBubble.id;
    stopRequestedBubbleRef.current = null;
    streamConversationIdRef.current = activeConversationId;
    streamWorkspaceIdRef.current = activeWorkspaceId;

    if (activeConversationId === null) {
      setPendingConversationState(activeWorkspaceId, [userBubble, assistantBubble]);
    } else {
      appendConversationBubbles(activeConversationId, [userBubble, assistantBubble]);
      setStreamingConversationId(activeConversationId);
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreamInFlight(true);

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
        updateStreamBubble(stopRequestedBubbleRef.current, (item) => ({
          ...item,
          status: "stopped",
        }));
      } else {
        setErrorMessage(getErrorMessage(error));
        updateStreamBubble(activeAssistantBubbleRef.current, (item) => ({
          ...item,
          status: "error",
        }));
      }
    } finally {
      const stoppedBubbleId = stopRequestedBubbleRef.current;
      const streamWorkspaceId = streamWorkspaceIdRef.current;
      updateStreamBubble(stoppedBubbleId, (item) => ({
        ...item,
        status: item.status === "error" ? item.status : "stopped",
      }));
      abortRef.current = null;
      setIsStreamInFlight(false);
      setStreamingConversationId(null);
      streamConversationIdRef.current = null;
      streamWorkspaceIdRef.current = null;
      activeAssistantBubbleRef.current = null;
      stopRequestedBubbleRef.current = null;
      if (streamWorkspaceId !== null) {
        void refreshWorkspaceConversations(streamWorkspaceId);
      }
    }
  }

  async function stopStreaming() {
    const targetConversationId = activeConversationId ?? streamConversationIdRef.current;
    const targetAssistantBubbleId = activeAssistantBubbleRef.current;
    stopRequestedBubbleRef.current = targetAssistantBubbleId;

    updateStreamBubble(targetAssistantBubbleId, (item) => ({
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

  async function handleDeleteConversation(conversationId: string, conversationTitle: string) {
    if (!window.confirm(`Delete "${conversationTitle}" permanently?`)) {
      return;
    }

    try {
      setErrorMessage(null);

      const isStreamingConversation = streamingConversationId === conversationId;
      if (isStreamingConversation) {
        stopRequestedBubbleRef.current = activeAssistantBubbleRef.current;
        try {
          await stopConversation(conversationId);
        } catch {
          // Best effort server-side cancellation.
        }
        abortRef.current?.abort();
      }

      await deleteConversation(conversationId);

      setConversationSummariesByWorkspaceId((current) => {
        const updated: Record<string, ConversationSummary[]> = {};
        for (const wsId of Object.keys(current)) {
          updated[wsId] = current[wsId].filter((c) => c.conversation_id !== conversationId);
        }
        return updated;
      });
      setConversationMessagesById((current) => {
        const { [conversationId]: _removed, ...rest } = current;
        return rest;
      });
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  const activeWorkspace = workspaces.find((item) => item.workspace_id === activeWorkspaceId) ?? null;
  const modelCatalogById = new Map(modelCatalog.map((item) => [item.model_id, item]));
  const settingsWorkspace =
    settingsDraft === null
      ? null
      : workspaces.find((item) => item.workspace_id === settingsDraft.workspaceId) ?? activeWorkspace;
  const settingsSelectedModel =
    settingsDraft === null ? null : modelCatalogById.get(settingsDraft.selectedModelId) ?? null;
  const settingsValidationErrors = getSettingsValidationErrors(settingsDraft, modelCatalog);
  const hasPendingSettings =
    settingsDraft !== null &&
    settingsWorkspace !== null &&
    (settingsDraft.name !== settingsWorkspace.name ||
      settingsDraft.systemMessage !== settingsWorkspace.system_message ||
      settingsDraft.selectedModelId !== settingsWorkspace.selected_model.model_id ||
      JSON.stringify(normalizeModelSettings(settingsDraft.modelSettings)) !==
        JSON.stringify(normalizeModelSettings(settingsWorkspace.model_settings)));
  const canSaveSettings = hasPendingSettings && !hasValidationErrors(settingsValidationErrors);
  const visibleConversations = activeWorkspaceId ? conversationSummariesByWorkspaceId[activeWorkspaceId] ?? [] : [];
  const activeMessages =
    activeConversationId === null
      ? pendingConversationWorkspaceId === activeWorkspaceId
        ? pendingConversationMessages
        : []
      : conversationMessagesById[activeConversationId] ?? [];
  const activeTitle =
    visibleConversations.find((item) => item.conversation_id === activeConversationId)?.conversation_title ??
    EMPTY_TITLE;
  const isGenerationBlocked = activeWorkspace?.selected_model.is_enabled === false;
  const showSendButton = !isStreamInFlight && draft.trim().length > 0 && !isGenerationBlocked;
  const showStopButton =
    isStreamInFlight &&
    ((activeConversationId !== null && activeConversationId === streamingConversationId) ||
      (activeConversationId === null &&
        pendingConversationWorkspaceId === activeWorkspaceId &&
        streamingConversationId === null &&
        pendingConversationMessages.length > 0));
  const selectedModelOptionMissing =
    settingsDraft !== null &&
    settingsWorkspace !== null &&
    settingsDraft.selectedModelId === settingsWorkspace.selected_model.model_id &&
    settingsSelectedModel === null;

  function canLeaveSettingsView(): boolean {
    if (!isSettingsOpen || !hasPendingSettings) {
      return true;
    }
    return window.confirm("Discard pending settings?");
  }

  function openWorkspaceSettings() {
    if (activeWorkspace === null) {
      return;
    }
    setErrorMessage(null);
    setActiveSettingsTab("general");
    setIsSettingsOpen(true);
    setSettingsDraft(createSettingsDraft(activeWorkspace));
  }

  function closeWorkspaceSettings() {
    if (!canLeaveSettingsView()) {
      return;
    }
    setIsSettingsOpen(false);
    setSettingsDraft(null);
    setActiveSettingsTab("general");
  }

  function updateSelectedModel(nextModelId: string) {
    setSettingsDraft((current) => {
      if (current === null) {
        return current;
      }
      const nextModel = modelCatalogById.get(nextModelId) ?? null;
      return {
        ...current,
        selectedModelId: nextModelId,
        modelSettings: createModelSettingsForModel(nextModel, current.modelSettings),
      };
    });
  }

  function updateModelSetting(settingKey: string, schema: ModelSettingSchema, rawValue: string) {
    setSettingsDraft((current) => {
      if (current === null) {
        return current;
      }
      return {
        ...current,
        modelSettings: {
          ...current.modelSettings,
          [settingKey]: schema.type === "number" ? (rawValue === "" ? Number.NaN : Number(rawValue)) : rawValue,
        },
      };
    });
  }

  async function saveWorkspaceSettings() {
    if (settingsDraft === null || !canSaveSettings) {
      return;
    }

    try {
      setErrorMessage(null);
      const updatedWorkspace = await updateWorkspace(settingsDraft.workspaceId, {
        name: settingsDraft.name.trim(),
        system_message: settingsDraft.systemMessage.trim(),
        selected_model_id: settingsDraft.selectedModelId,
        model_settings: normalizeModelSettings(settingsDraft.modelSettings),
      });
      setWorkspaces((current) =>
        current.map((item) => (item.workspace_id === updatedWorkspace.workspace_id ? updatedWorkspace : item)),
      );
      setSettingsDraft(createSettingsDraft(updatedWorkspace));
      setActiveSettingsTab("general");
      setIsSettingsOpen(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

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
        <div className="workspace-default-model" aria-live="polite">
          <span>預設模型</span>
          <strong>{defaultWorkspaceModel?.label ?? "載入中..."}</strong>
        </div>

        <div className="conversation-list">
          {workspaces.map((workspace, index) => (
            <div key={workspace.workspace_id} className="workspace-row">
              <button
                type="button"
                className={`conversation-item${workspace.workspace_id === activeWorkspaceId ? " active" : ""}`}
                onClick={() => selectWorkspace(workspace.workspace_id)}
              >
                <strong>{workspace.name}</strong>
                <span>{workspace.selected_model.label}</span>
              </button>
              <div className="workspace-actions">
                <button
                  type="button"
                  className="workspace-action-button"
                  onClick={() => void handleMoveWorkspace(workspace.workspace_id, -1)}
                  aria-label={`Move up ${workspace.name}`}
                  disabled={index === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="workspace-action-button"
                  onClick={() => void handleMoveWorkspace(workspace.workspace_id, 1)}
                  aria-label={`Move down ${workspace.name}`}
                  disabled={index === workspaces.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="workspace-action-button warn"
                  onClick={() => void handleArchiveWorkspace(workspace.workspace_id)}
                  aria-label={`Archive ${workspace.name}`}
                >
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-header">
            <div>
              <h2 className="sidebar-title">Archived Workspaces</h2>
              <p className="sidebar-subtitle">Restore before using them again</p>
            </div>
          </div>

          <div className="conversation-list">
            {archivedWorkspaces.length === 0 ? (
              <div className="sidebar-empty">No archived workspaces</div>
            ) : (
              archivedWorkspaces.map((workspace) => (
                <div key={workspace.workspace_id} className="workspace-row archived">
                  <div className="conversation-item archived">
                    <strong>{workspace.name}</strong>
                    <span>{workspace.selected_model.label}</span>
                  </div>
                  <div className="workspace-actions">
                    <button
                      type="button"
                      className="workspace-action-button"
                      onClick={() => void handleRestoreWorkspace(workspace.workspace_id)}
                      aria-label={`Restore ${workspace.name}`}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
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
            disabled={activeWorkspaceId === null || isStreamInFlight}
          >
            <PlusIcon />
          </button>
        </div>

        <div className="conversation-list">
          {visibleConversations.map((conversation) => (
            <div key={conversation.conversation_id} className="conversation-row">
              <button
                type="button"
                className={`conversation-item${
                  conversation.conversation_id === activeConversationId ? " active" : ""
                }`}
                onClick={() => void loadConversation(conversation.conversation_id)}
              >
                <div className="conversation-item-header">
                  <strong>{conversation.conversation_title}</strong>
                  {conversation.conversation_id === streamingConversationId ? (
                    <span className="conversation-activity-badge">Streaming</span>
                  ) : null}
                </div>
                <span>{formatTime(conversation.updated_at)}</span>
              </button>
              <div className="conversation-actions">
                <button
                  type="button"
                  className="workspace-action-button warn"
                  onClick={() =>
                    void handleDeleteConversation(
                      conversation.conversation_id,
                      conversation.conversation_title,
                    )
                  }
                  aria-label={`Delete ${conversation.conversation_title}`}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="chat-panel">
        <div className="chat-header">
          <div className="chat-header-row">
            <div>
              <h2>{isSettingsOpen ? "Workspace Settings" : activeTitle}</h2>
              <p>
                {activeWorkspace
                  ? `${activeWorkspace.name} | ${activeWorkspace.selected_model.label}`
                  : "Create a Workspace before starting a Conversation."}
              </p>
            </div>
            {activeWorkspace ? (
              <button
                type="button"
                className="secondary-button"
                onClick={isSettingsOpen ? closeWorkspaceSettings : openWorkspaceSettings}
                aria-label={isSettingsOpen ? "Back to chat" : "Open workspace settings"}
              >
                {isSettingsOpen ? "Back to chat" : "Settings"}
              </button>
            ) : null}
          </div>
        </div>

        {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

        {isSettingsOpen && settingsDraft && settingsWorkspace ? (
          <>
            <section className="messages settings-panel">
              <div className="settings-card">
                <div className="settings-tabs" role="tablist" aria-label="Workspace settings tabs">
                  <button
                    type="button"
                    className={`settings-tab${activeSettingsTab === "general" ? " active" : ""}`}
                    role="tab"
                    aria-selected={activeSettingsTab === "general"}
                    onClick={() => setActiveSettingsTab("general")}
                  >
                    General
                  </button>
                  <button
                    type="button"
                    className={`settings-tab${activeSettingsTab === "model" ? " active" : ""}`}
                    role="tab"
                    aria-selected={activeSettingsTab === "model"}
                    onClick={() => setActiveSettingsTab("model")}
                  >
                    Model
                  </button>
                </div>

                {activeSettingsTab === "general" ? (
                  <>
                    <div className="settings-field">
                      <label htmlFor="workspace-name-input">Workspace Name</label>
                      <input
                        id="workspace-name-input"
                        value={settingsDraft.name}
                        onChange={(nextEvent) =>
                          setSettingsDraft((current) =>
                            current === null ? current : { ...current, name: nextEvent.target.value },
                          )
                        }
                        aria-label="Workspace Name"
                      />
                      {settingsValidationErrors.name ? (
                        <div className="field-error">{settingsValidationErrors.name}</div>
                      ) : null}
                    </div>

                    <div className="settings-field">
                      <label htmlFor="system-message-input">System Message</label>
                      <textarea
                        id="system-message-input"
                        value={settingsDraft.systemMessage}
                        onChange={(nextEvent) =>
                          setSettingsDraft((current) =>
                            current === null ? current : { ...current, systemMessage: nextEvent.target.value },
                          )
                        }
                        aria-label="System Message"
                      />
                      {settingsValidationErrors.systemMessage ? (
                        <div className="field-error">{settingsValidationErrors.systemMessage}</div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="settings-field">
                      <label htmlFor="selected-model-input">Selected Model</label>
                      <select
                        id="selected-model-input"
                        value={settingsDraft.selectedModelId}
                        onChange={(nextEvent) => updateSelectedModel(nextEvent.target.value)}
                        aria-label="Selected Model"
                      >
                        {selectedModelOptionMissing ? (
                          <option value={settingsDraft.selectedModelId}>
                            {settingsWorkspace.selected_model.label} (disabled)
                          </option>
                        ) : null}
                        {modelCatalog.map((model) => (
                          <option key={model.model_id} value={model.model_id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                      {settingsValidationErrors.selectedModelId ? (
                        <div className="field-error">{settingsValidationErrors.selectedModelId}</div>
                      ) : null}
                    </div>

                    {settingsSelectedModel ? (
                      Object.entries(settingsSelectedModel.settings_schema).map(([settingKey, schema]) => (
                        <div key={settingKey} className="settings-field">
                          <label htmlFor={`model-setting-${settingKey}`}>{schema.label}</label>
                          {schema.type === "number" ? (
                            <input
                              id={`model-setting-${settingKey}`}
                              type="number"
                              min={schema.min}
                              max={schema.max}
                              step={schema.step ?? 0.1}
                              value={String(settingsDraft.modelSettings[settingKey] ?? "")}
                              onChange={(nextEvent) => updateModelSetting(settingKey, schema, nextEvent.target.value)}
                              aria-label={schema.label}
                            />
                          ) : (
                            <select
                              id={`model-setting-${settingKey}`}
                              value={String(settingsDraft.modelSettings[settingKey] ?? "")}
                              onChange={(nextEvent) => updateModelSetting(settingKey, schema, nextEvent.target.value)}
                              aria-label={schema.label}
                            >
                              {(schema.options ?? []).map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          )}
                          {schema.help_text ? <div className="settings-hint">{schema.help_text}</div> : null}
                          {settingsValidationErrors.modelSettings[settingKey] ? (
                            <div className="field-error">{settingsValidationErrors.modelSettings[settingKey]}</div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="settings-hint">
                        Select an enabled model to review the available Model-specific Settings.
                      </div>
                    )}
                  </>
                )}

                <div className="settings-hint">
                  Pending settings stay local until you explicitly save them for future turns.
                </div>
              </div>
            </section>

            <div className="composer settings-actions">
              <div className="settings-actions-row">
                <button type="button" className="secondary-button" onClick={closeWorkspaceSettings}>
                  Back to chat
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void saveWorkspaceSettings()}
                  disabled={!canSaveSettings}
                >
                  Save settings
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <section className="messages">
              {activeMessages.length === 0 ? (
                <div className="empty-state">
                  <h3>
                    {activeWorkspace
                      ? isGenerationBlocked
                        ? "這個 Workspace 目前無法送出新對話"
                        : "\u958b\u59cb\u4e00\u6bb5\u65b0\u5c0d\u8a71"
                      : "\u5148\u5efa\u7acb\u5de5\u4f5c\u5340"}
                  </h3>
                  <p>
                    {activeWorkspace
                      ? isGenerationBlocked
                        ? "Selected Model is disabled for new generation. Open Workspace Settings and choose an enabled model."
                        : "\u7b2c\u4e00\u53e5 User Prompt \u9001\u51fa\u5f8c\u624d\u6703\u5728\u9019\u500b Workspace \u5efa\u7acb Conversation\u3002"
                      : "\u5de6\u5074\u8f38\u5165 Workspace Name \u4e26\u5efa\u7acb\uff0c\u518d\u958b\u59cb\u5c0d\u8a71\u3002"}
                  </p>
                </div>
              ) : (
                activeMessages.map((message) => (
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
                    activeWorkspace
                      ? isGenerationBlocked
                        ? "請先在 Workspace Settings 選擇可用模型"
                        : "\u8f38\u5165\u8a0a\u606f..."
                      : "\u5148\u5efa\u7acb\u6216\u9078\u64c7\u5de5\u4f5c\u5340"
                  }
                  aria-label={"\u8a0a\u606f\u8f38\u5165\u6846"}
                  disabled={activeWorkspaceId === null || isGenerationBlocked}
                />

                <div className="composer-actions">
                  {showStopButton ? (
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
          </>
        )}
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
