import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import "./App.css";
import {
  archiveWorkspace,
  cancelImportJob,
  createImportJob,
  createWorkspace,
  deleteConversation,
  getDefaultWorkspaceModel,
  getKnowledgeBaseSettings,
  getConversation,
  listArchivedWorkspaces,
  listKnowledgeBaseJobs,
  listModels,
  listWorkspaceConversations,
  listWorkspaces,
  openChatStream,
  reorderWorkspaces,
  restoreWorkspace,
  stopConversation,
  toChatBubbles,
  updateKnowledgeBaseSettings,
  updateWorkspace,
} from "./api";
import {
  ArchiveBoxIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
} from "./components/Icons";
import { readSseStream } from "./lib/sse";
import type {
  ChatBubble,
  ConversationSummary,
  KnowledgeBaseJob,
  KnowledgeBaseJobList,
  KnowledgeBaseSettings,
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

type KnowledgeBaseSettingsDraft = {
  workspaceId: string;
  chunkSize: number;
  chunkOverlap: number;
  retrievalTopK: number;
  similarityThreshold: number;
  knowledgeAnsweringDefault: boolean;
  rebuildRequired: boolean;
};

type SettingsValidationErrors = {
  name?: string;
  systemMessage?: string;
  selectedModelId?: string;
  modelSettings: Record<string, string>;
};

type KnowledgeBaseSettingsValidationErrors = {
  chunkSize?: string;
  chunkOverlap?: string;
  retrievalTopK?: string;
  similarityThreshold?: string;
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

function createKnowledgeBaseSettingsDraft(
  knowledgeBaseSettings: KnowledgeBaseSettings,
): KnowledgeBaseSettingsDraft {
  return {
    workspaceId: knowledgeBaseSettings.workspace_id,
    chunkSize: knowledgeBaseSettings.chunk_size,
    chunkOverlap: knowledgeBaseSettings.chunk_overlap,
    retrievalTopK: knowledgeBaseSettings.retrieval_top_k,
    similarityThreshold: knowledgeBaseSettings.similarity_threshold,
    knowledgeAnsweringDefault: knowledgeBaseSettings.knowledge_answering_default,
    rebuildRequired: knowledgeBaseSettings.rebuild_required,
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

function getKnowledgeBaseSettingsValidationErrors(
  draft: KnowledgeBaseSettingsDraft | null,
): KnowledgeBaseSettingsValidationErrors {
  if (draft === null) {
    return {};
  }

  const errors: KnowledgeBaseSettingsValidationErrors = {};
  if (!Number.isInteger(draft.chunkSize) || draft.chunkSize < 1) {
    errors.chunkSize = "Chunk Size must be at least 1";
  }
  if (!Number.isInteger(draft.chunkOverlap) || draft.chunkOverlap < 0) {
    errors.chunkOverlap = "Chunk Overlap cannot be negative";
  } else if (draft.chunkOverlap >= draft.chunkSize) {
    errors.chunkOverlap = "Chunk Overlap must be smaller than Chunk Size";
  }
  if (!Number.isInteger(draft.retrievalTopK) || draft.retrievalTopK < 1) {
    errors.retrievalTopK = "Top K must be at least 1";
  }
  if (Number.isNaN(draft.similarityThreshold) || draft.similarityThreshold < 0 || draft.similarityThreshold > 1) {
    errors.similarityThreshold = "Similarity Threshold must be between 0 and 1";
  }
  return errors;
}

function hasKnowledgeBaseValidationErrors(errors: KnowledgeBaseSettingsValidationErrors): boolean {
  return Object.values(errors).some(Boolean);
}

function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}


export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [archivedWorkspaces, setArchivedWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [knowledgeBaseSettingsByWorkspaceId, setKnowledgeBaseSettingsByWorkspaceId] = useState<
    Record<string, KnowledgeBaseSettings>
  >({});
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
  const [knowledgeBaseSettingsDraft, setKnowledgeBaseSettingsDraft] = useState<KnowledgeBaseSettingsDraft | null>(null);
  const [isKnowledgeBaseSettingsLoading, setIsKnowledgeBaseSettingsLoading] = useState(false);
  const [isKnowledgeBaseManagementOpen, setIsKnowledgeBaseManagementOpen] = useState(false);
  const [kbJobList, setKbJobList] = useState<KnowledgeBaseJobList>({
    active: [],
    history: [],
    history_total: 0,
    history_page: 1,
  });
  const [isKbJobsLoading, setIsKbJobsLoading] = useState(false);
  const [selectedImportFiles, setSelectedImportFiles] = useState<File[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"general" | "model" | "knowledgeBase">("general");
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
      setKnowledgeBaseSettingsDraft(null);
      setIsKnowledgeBaseManagementOpen(false);
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

  async function loadKnowledgeBaseSettings(workspaceId: string) {
    try {
      setIsKnowledgeBaseSettingsLoading(true);
      const data = {
        ...(await getKnowledgeBaseSettings(workspaceId)),
        workspace_id: workspaceId,
      };
      setKnowledgeBaseSettingsByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: data,
      }));
      setKnowledgeBaseSettingsDraft((current) => {
        if (current !== null && current.workspaceId === workspaceId) {
          return current;
        }
        return createKnowledgeBaseSettingsDraft(data);
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsKnowledgeBaseSettingsLoading(false);
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
      setKnowledgeBaseSettingsDraft(null);
      setIsKnowledgeBaseManagementOpen(false);
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
    setKnowledgeBaseSettingsDraft(null);
    setIsKnowledgeBaseManagementOpen(false);
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
    setKnowledgeBaseSettingsDraft(null);
    setIsKnowledgeBaseManagementOpen(false);
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
        setKnowledgeBaseSettingsDraft(null);
        setIsKnowledgeBaseManagementOpen(false);
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
      setIsKnowledgeBaseManagementOpen(false);
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
  const savedKnowledgeBaseSettings =
    settingsDraft === null ? null : knowledgeBaseSettingsByWorkspaceId[settingsDraft.workspaceId] ?? null;
  const settingsSelectedModel =
    settingsDraft === null ? null : modelCatalogById.get(settingsDraft.selectedModelId) ?? null;
  const settingsValidationErrors = getSettingsValidationErrors(settingsDraft, modelCatalog);
  const knowledgeBaseSettingsValidationErrors = getKnowledgeBaseSettingsValidationErrors(knowledgeBaseSettingsDraft);
  const hasPendingWorkspaceSettings =
    settingsDraft !== null &&
    settingsWorkspace !== null &&
    (settingsDraft.name !== settingsWorkspace.name ||
      settingsDraft.systemMessage !== settingsWorkspace.system_message ||
      settingsDraft.selectedModelId !== settingsWorkspace.selected_model.model_id ||
      JSON.stringify(normalizeModelSettings(settingsDraft.modelSettings)) !==
        JSON.stringify(normalizeModelSettings(settingsWorkspace.model_settings)));
  const hasPendingKnowledgeBaseSettings =
    knowledgeBaseSettingsDraft !== null &&
    savedKnowledgeBaseSettings !== null &&
    (knowledgeBaseSettingsDraft.chunkSize !== savedKnowledgeBaseSettings.chunk_size ||
      knowledgeBaseSettingsDraft.chunkOverlap !== savedKnowledgeBaseSettings.chunk_overlap ||
      knowledgeBaseSettingsDraft.retrievalTopK !== savedKnowledgeBaseSettings.retrieval_top_k ||
      knowledgeBaseSettingsDraft.similarityThreshold !== savedKnowledgeBaseSettings.similarity_threshold ||
      knowledgeBaseSettingsDraft.knowledgeAnsweringDefault !==
        savedKnowledgeBaseSettings.knowledge_answering_default);
  const hasPendingSettings = hasPendingWorkspaceSettings || hasPendingKnowledgeBaseSettings;
  const canSaveSettings =
    hasPendingSettings &&
    !hasValidationErrors(settingsValidationErrors) &&
    !hasKnowledgeBaseValidationErrors(knowledgeBaseSettingsValidationErrors);
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
    if ((!isSettingsOpen && !isKnowledgeBaseManagementOpen) || !hasPendingSettings) {
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
    setIsKnowledgeBaseManagementOpen(false);
    setIsSettingsOpen(true);
    setSettingsDraft(createSettingsDraft(activeWorkspace));
    const cachedKnowledgeBaseSettings = knowledgeBaseSettingsByWorkspaceId[activeWorkspace.workspace_id];
    setKnowledgeBaseSettingsDraft(
      cachedKnowledgeBaseSettings ? createKnowledgeBaseSettingsDraft(cachedKnowledgeBaseSettings) : null,
    );
    void loadKnowledgeBaseSettings(activeWorkspace.workspace_id);
  }

  function closeWorkspaceSettings() {
    if (!canLeaveSettingsView()) {
      return;
    }
    setIsSettingsOpen(false);
    setIsKnowledgeBaseManagementOpen(false);
    setSettingsDraft(null);
    setKnowledgeBaseSettingsDraft(null);
    setActiveSettingsTab("general");
  }

  function openKnowledgeBaseManagement() {
    if (activeWorkspace === null) {
      return;
    }
    if (!canLeaveSettingsView()) {
      return;
    }
    setIsSettingsOpen(false);
    setIsKnowledgeBaseManagementOpen(true);
    setSettingsDraft(null);
    setKnowledgeBaseSettingsDraft(null);
    setActiveSettingsTab("knowledgeBase");
    void loadKbJobs(activeWorkspace.workspace_id);
  }

  async function loadKbJobs(workspaceId: string, page = 1) {
    setIsKbJobsLoading(true);
    try {
      const result = await listKnowledgeBaseJobs(workspaceId, page);
      setKbJobList(result);
    } catch {
      // Ignore load errors; jobs list will stay empty.
    } finally {
      setIsKbJobsLoading(false);
    }
  }

  async function handleImportFiles() {
    if (!activeWorkspace || selectedImportFiles.length === 0) return;
    setIsImporting(true);
    try {
      await createImportJob(activeWorkspace.workspace_id, selectedImportFiles);
      setSelectedImportFiles([]);
      await loadKbJobs(activeWorkspace.workspace_id);
    } catch {
      // Ignore import errors for this slice.
    } finally {
      setIsImporting(false);
    }
  }

  async function handleCancelJob(jobId: string) {
    if (!activeWorkspace) return;
    try {
      await cancelImportJob(activeWorkspace.workspace_id, jobId);
      await loadKbJobs(activeWorkspace.workspace_id);
    } catch {
      // Ignore cancel errors.
    }
  }

  function backToWorkspaceSettingsFromKnowledgeBaseManagement() {
    if (activeWorkspace === null) {
      return;
    }
    setErrorMessage(null);
    setIsKnowledgeBaseManagementOpen(false);
    setIsSettingsOpen(true);
    setSettingsDraft(createSettingsDraft(activeWorkspace));
    const cachedKnowledgeBaseSettings = knowledgeBaseSettingsByWorkspaceId[activeWorkspace.workspace_id];
    setKnowledgeBaseSettingsDraft(
      cachedKnowledgeBaseSettings ? createKnowledgeBaseSettingsDraft(cachedKnowledgeBaseSettings) : null,
    );
    setActiveSettingsTab("knowledgeBase");
    void loadKnowledgeBaseSettings(activeWorkspace.workspace_id);
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

  function updateKnowledgeBaseSetting(
    key: "chunkSize" | "chunkOverlap" | "retrievalTopK" | "similarityThreshold",
    rawValue: string,
  ) {
    setKnowledgeBaseSettingsDraft((current) => {
      if (current === null) {
        return current;
      }
      const nextValue = rawValue === "" ? Number.NaN : Number(rawValue);
      return {
        ...current,
        [key]: nextValue,
      };
    });
  }

  async function saveWorkspaceSettings() {
    if (settingsDraft === null || !canSaveSettings) {
      return;
    }

    try {
      setErrorMessage(null);
      let updatedWorkspace: WorkspaceSummary | null = null;
      if (hasPendingWorkspaceSettings) {
        updatedWorkspace = await updateWorkspace(settingsDraft.workspaceId, {
          name: settingsDraft.name.trim(),
          system_message: settingsDraft.systemMessage.trim(),
          selected_model_id: settingsDraft.selectedModelId,
          model_settings: normalizeModelSettings(settingsDraft.modelSettings),
        });
        setWorkspaces((current) =>
          current.map((item) => (item.workspace_id === updatedWorkspace.workspace_id ? updatedWorkspace : item)),
        );
        setSettingsDraft(createSettingsDraft(updatedWorkspace));
      }

      if (hasPendingKnowledgeBaseSettings && knowledgeBaseSettingsDraft !== null) {
        const updatedKnowledgeBaseSettings = await updateKnowledgeBaseSettings(settingsDraft.workspaceId, {
          chunk_size: knowledgeBaseSettingsDraft.chunkSize,
          chunk_overlap: knowledgeBaseSettingsDraft.chunkOverlap,
          retrieval_top_k: knowledgeBaseSettingsDraft.retrievalTopK,
          similarity_threshold: knowledgeBaseSettingsDraft.similarityThreshold,
          knowledge_answering_default: knowledgeBaseSettingsDraft.knowledgeAnsweringDefault,
        });
        setKnowledgeBaseSettingsByWorkspaceId((current) => ({
          ...current,
          [updatedKnowledgeBaseSettings.workspace_id]: updatedKnowledgeBaseSettings,
        }));
        setKnowledgeBaseSettingsDraft(createKnowledgeBaseSettingsDraft(updatedKnowledgeBaseSettings));
      }

      if (!hasPendingWorkspaceSettings && settingsWorkspace !== null) {
        setSettingsDraft(createSettingsDraft(settingsWorkspace));
      }
      setIsSettingsOpen(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  return (
    <div className="app-shell min-h-screen px-4 py-4 text-stone-950 md:px-6 md:py-6">
      <div className="mx-auto grid max-w-[1600px] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="sidebar flex max-h-[calc(100vh-2rem)] min-h-[720px] flex-col overflow-hidden rounded-[2rem] border border-white/70 bg-[rgba(255,250,245,0.86)] p-4 shadow-[0_28px_90px_rgba(41,37,36,0.12)] backdrop-blur-xl">
          <div className="sidebar-header mb-4">
            <div className="space-y-2">
              <div className="inline-flex items-center rounded-full border border-stone-900/10 bg-stone-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-50">
                Workspace Console
              </div>
              <div>
                <h1 className="sidebar-title font-['Iowan_Old_Style','Palatino_Linotype','Noto_Serif_TC',serif] text-3xl font-semibold tracking-[-0.03em] text-stone-950">
                  {"\u5de5\u4f5c\u5340"}
                </h1>
                <p className="sidebar-subtitle mt-1 text-sm text-stone-600">
                  Anything-LLM style workspace chat with streaming responses
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/80 bg-white/80 p-4 shadow-[0_14px_30px_rgba(28,25,23,0.06)]">
            <form className="composer-form flex items-end gap-3" onSubmit={handleCreateWorkspace}>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="new-workspace-name"
                  className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                >
                  {"\u65b0\u5de5\u4f5c\u5340"}
                </label>
                <input
                  id="new-workspace-name"
                  className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 placeholder:text-stone-400 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
                  value={newWorkspaceName}
                  onChange={(nextEvent) => setNewWorkspaceName(nextEvent.target.value)}
                  placeholder={"\u8f38\u5165\u5de5\u4f5c\u5340\u540d\u7a31"}
                  aria-label={"\u5de5\u4f5c\u5340\u540d\u7a31"}
                />
              </div>
              <div className="composer-actions shrink-0">
                <button
                  type="submit"
                  className="icon-button inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-950 text-white shadow-[0_16px_30px_rgba(24,24,27,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-rose-500 focus:outline-none focus:ring-4 focus:ring-rose-200/70"
                  aria-label={"\u5efa\u7acb\u5de5\u4f5c\u5340"}
                >
                  <PlusIcon className="h-5 w-5" />
                </button>
              </div>
            </form>
            <div className="workspace-default-model mt-4 flex items-center justify-between gap-3 rounded-[1.25rem] border border-stone-200/80 bg-[#f6efe6] px-4 py-3 text-sm text-stone-700" aria-live="polite">
              <span className="text-stone-500">預設模型</span>
              <strong className="font-medium text-stone-950">{defaultWorkspaceModel?.label ?? "載入中..."}</strong>
            </div>
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
            <section className="sidebar-section flex min-h-0 flex-col rounded-[1.75rem] border border-white/70 bg-white/70 p-3 shadow-[0_10px_25px_rgba(28,25,23,0.05)]">
              <div className="sidebar-header mb-3 px-2">
                <div>
                  <h2 className="sidebar-title text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Workspaces
                  </h2>
                  <p className="sidebar-subtitle mt-1 text-sm text-stone-600">Save a tone, model, and system prompt per workspace.</p>
                </div>
              </div>
              <div className="conversation-list chat-scrollbar flex min-h-0 flex-col overflow-y-auto pr-1">
                {workspaces.map((workspace, index) => (
                  <div
                    key={workspace.workspace_id}
                    className="workspace-row grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-2 border-b border-stone-200/80 py-1 last:border-b-0"
                  >
                    <button
                      type="button"
                      aria-label={`${workspace.name} ${workspace.selected_model.label}`}
                      className={cn(
                        "conversation-item group relative flex min-w-0 items-center gap-3 px-3 py-3 text-left transition duration-200 focus:outline-none focus:ring-4 focus:ring-rose-200/70",
                        workspace.workspace_id === activeWorkspaceId
                          ? "active bg-stone-950 text-stone-50"
                          : "text-stone-900 hover:bg-white/90",
                      )}
                      onClick={() => selectWorkspace(workspace.workspace_id)}
                    >
                      <span
                        className={cn(
                          "h-10 w-1 shrink-0 rounded-full transition-colors duration-200",
                          workspace.workspace_id === activeWorkspaceId ? "bg-rose-400" : "bg-stone-200 group-hover:bg-rose-200",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <strong className="truncate text-[15px] font-semibold tracking-[-0.02em]">{workspace.name}</strong>
                          <span
                            className={cn(
                              "shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em]",
                              workspace.workspace_id === activeWorkspaceId ? "text-stone-300" : "text-rose-500",
                            )}
                          >
                            Live
                          </span>
                        </div>
                        <span
                          className={cn(
                            "mt-1 block truncate text-xs",
                            workspace.workspace_id === activeWorkspaceId ? "text-stone-300" : "text-stone-500",
                          )}
                        >
                          {workspace.selected_model.label}
                        </span>
                      </div>
                    </button>
                    <div className="workspace-actions flex items-center gap-1 self-center">
                      <button
                        type="button"
                        className="workspace-action-button inline-flex h-8 w-8 items-center justify-center rounded-xl text-stone-500 transition duration-200 hover:bg-stone-200/80 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void handleMoveWorkspace(workspace.workspace_id, -1)}
                        aria-label={`Move up ${workspace.name}`}
                        disabled={index === 0}
                      >
                        <ChevronUpIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="workspace-action-button inline-flex h-8 w-8 items-center justify-center rounded-xl text-stone-500 transition duration-200 hover:bg-stone-200/80 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void handleMoveWorkspace(workspace.workspace_id, 1)}
                        aria-label={`Move down ${workspace.name}`}
                        disabled={index === workspaces.length - 1}
                      >
                        <ChevronDownIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="workspace-action-button warn inline-flex h-8 w-8 items-center justify-center rounded-xl text-amber-700 transition duration-200 hover:bg-amber-100/80"
                        onClick={() => void handleArchiveWorkspace(workspace.workspace_id)}
                        aria-label={`Archive ${workspace.name}`}
                      >
                        <ArchiveBoxIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="sidebar-section rounded-[1.75rem] border border-dashed border-stone-300/80 bg-stone-50/70 p-3">
              <div className="sidebar-header mb-3 px-2">
                <div>
                  <h2 className="sidebar-title text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Archived Workspaces
                  </h2>
                  <p className="sidebar-subtitle mt-1 text-sm text-stone-600">Restore before using them again</p>
                </div>
              </div>

              <div className="conversation-list chat-scrollbar flex max-h-52 flex-col overflow-y-auto pr-1">
                {archivedWorkspaces.length === 0 ? (
                  <div className="sidebar-empty rounded-[1.25rem] border border-dashed border-stone-300 bg-white/70 px-4 py-5 text-sm text-stone-500">
                    No archived workspaces
                  </div>
                ) : (
                  archivedWorkspaces.map((workspace) => (
                    <div
                      key={workspace.workspace_id}
                      className="workspace-row archived grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-stone-200/70 py-1 last:border-b-0"
                    >
                      <div className="conversation-item archived flex min-w-0 items-center gap-3 px-3 py-3 text-left text-stone-700">
                        <span className="h-8 w-1 shrink-0 rounded-full bg-stone-300" />
                        <div className="min-w-0">
                          <strong className="truncate text-sm font-semibold tracking-[-0.01em]">{workspace.name}</strong>
                          <span className="mt-1 block truncate text-xs text-stone-500">{workspace.selected_model.label}</span>
                        </div>
                      </div>
                      <div className="workspace-actions flex items-center gap-2">
                        <button
                          type="button"
                          className="workspace-action-button inline-flex min-h-8 items-center justify-center rounded-xl px-2.5 text-sm font-medium text-stone-700 transition duration-200 hover:bg-white/90 hover:text-rose-500"
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
            </section>

            <section className="sidebar-section flex min-h-0 flex-1 flex-col rounded-[1.75rem] border border-white/70 bg-white/70 p-3 shadow-[0_10px_25px_rgba(28,25,23,0.05)]">
              <div className="sidebar-header mb-3 px-2">
                <div>
                  <h2 className="sidebar-title text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                    {"\u5c0d\u8a71"}
                  </h2>
                  <p className="sidebar-subtitle mt-1 text-sm text-stone-600">
                    {activeWorkspace ? activeWorkspace.name : "\u5148\u5efa\u7acb\u6216\u9078\u64c7\u5de5\u4f5c\u5340"}
                  </p>
                </div>
                <button
                  type="button"
                  className="new-chat-button inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-900 transition duration-200 hover:-translate-y-0.5 hover:border-rose-200 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={startNewConversation}
                  aria-label={"\u65b0\u589e\u5c0d\u8a71"}
                  title={"\u65b0\u589e\u5c0d\u8a71"}
                  disabled={activeWorkspaceId === null || isStreamInFlight}
                >
                  <PlusIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="conversation-list chat-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
                {visibleConversations.length === 0 ? (
                  <div className="rounded-[1.25rem] border border-dashed border-stone-300 bg-stone-50/80 px-4 py-5 text-sm text-stone-500">
                    No conversations yet
                  </div>
                ) : null}
                {visibleConversations.map((conversation) => (
                  <div
                    key={conversation.conversation_id}
                    className="conversation-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-stone-200/80 py-1 last:border-b-0"
                  >
                    <button
                      type="button"
                      aria-label={conversation.conversation_title}
                      className={cn(
                        "conversation-item flex min-w-0 items-center gap-3 px-3 py-3 text-left transition duration-200 focus:outline-none focus:ring-4 focus:ring-rose-200/70",
                        conversation.conversation_id === activeConversationId
                          ? "active bg-rose-50/90"
                          : "hover:bg-white/90",
                      )}
                      onClick={() => void loadConversation(conversation.conversation_id)}
                    >
                      <span
                        className={cn(
                          "h-8 w-1 shrink-0 rounded-full transition-colors duration-200",
                          conversation.conversation_id === activeConversationId
                            ? "bg-rose-400"
                            : conversation.conversation_id === streamingConversationId
                              ? "bg-stone-900"
                              : "bg-stone-200",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="conversation-item-header flex items-center justify-between gap-3">
                          <strong className="truncate text-sm font-semibold tracking-[-0.01em] text-stone-900">
                            {conversation.conversation_title}
                          </strong>
                          {conversation.conversation_id === streamingConversationId ? (
                            <span className="conversation-activity-badge inline-flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-700">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
                              Streaming
                            </span>
                          ) : null}
                        </div>
                        <span className="mt-1 block text-xs text-stone-500">{formatTime(conversation.updated_at)}</span>
                      </div>
                    </button>
                    <div className="conversation-actions flex items-center gap-2">
                      <button
                        type="button"
                        className="workspace-action-button warn inline-flex min-h-8 items-center justify-center rounded-xl px-2.5 text-sm font-medium text-rose-700 transition duration-200 hover:bg-rose-50"
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
            </section>
          </div>
        </aside>

        <main className="chat-panel grid min-h-[720px] overflow-hidden rounded-[2rem] border border-white/70 bg-[rgba(255,252,248,0.82)] shadow-[0_28px_90px_rgba(41,37,36,0.12)] backdrop-blur-xl">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            <div className="chat-header border-b border-stone-200/80 px-5 pb-5 pt-5 md:px-8 md:pt-7">
              <div className="chat-header-row flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="max-w-3xl space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Anthropic Console tone
                  </div>
                  <div>
                    <h2 className="font-['Iowan_Old_Style','Palatino_Linotype','Noto_Serif_TC',serif] text-3xl font-semibold tracking-[-0.03em] text-stone-950">
                      {isKnowledgeBaseManagementOpen
                        ? "Knowledge Base Management"
                        : isSettingsOpen
                          ? "Workspace Settings"
                          : activeTitle}
                    </h2>
                    <p className="mt-2 text-sm text-stone-600">
                      {activeWorkspace
                        ? `${activeWorkspace.name} | ${activeWorkspace.selected_model.label}`
                        : "Create a Workspace before starting a Conversation."}
                    </p>
                  </div>
                </div>
                {activeWorkspace ? (
                  <button
                    type="button"
                    className="secondary-button inline-flex items-center justify-center gap-2 self-start rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 text-sm font-medium text-stone-700 transition duration-200 hover:-translate-y-0.5 hover:border-rose-200 hover:text-rose-500 focus:outline-none focus:ring-4 focus:ring-rose-200/70"
                    onClick={
                      isKnowledgeBaseManagementOpen
                        ? backToWorkspaceSettingsFromKnowledgeBaseManagement
                        : isSettingsOpen
                          ? closeWorkspaceSettings
                          : openWorkspaceSettings
                    }
                    aria-label={
                      isKnowledgeBaseManagementOpen
                        ? "Workspace settings"
                        : isSettingsOpen
                          ? "Back to chat"
                          : "Open workspace settings"
                    }
                  >
                    <SlidersIcon className="h-4 w-4" />
                    {isKnowledgeBaseManagementOpen
                      ? "Workspace settings"
                      : isSettingsOpen
                        ? "Back to chat"
                        : "Settings"}
                  </button>
                ) : null}
              </div>
            </div>

            {errorMessage ? (
              <div className="error-banner mx-5 mt-5 rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 md:mx-8" role="alert">
                {errorMessage}
              </div>
            ) : null}

            {isKnowledgeBaseManagementOpen && activeWorkspace ? (
              <>
                <section className="messages settings-panel chat-scrollbar overflow-y-auto px-5 py-5 md:px-8">
                  <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 rounded-[2rem] border border-white/80 bg-white/88 p-5 shadow-[0_20px_50px_rgba(28,25,23,0.08)] md:p-7">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Workspace knowledge base
                        </p>
                      </div>
                    </div>

                    {/* Upload section */}
                    <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50/80 px-6 py-6 flex flex-col gap-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                        Import documents
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <label
                          htmlFor="kb-file-input"
                          className="cursor-pointer rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:border-stone-300 hover:bg-stone-50"
                        >
                          Select files to import
                          <input
                            id="kb-file-input"
                            type="file"
                            multiple
                            aria-label="Select files to import"
                            className="sr-only"
                            onChange={(e) => {
                              const files = Array.from(e.target.files ?? []);
                              setSelectedImportFiles(files);
                            }}
                          />
                        </label>
                        {selectedImportFiles.length > 0 && (
                          <span className="text-sm text-stone-600">
                            {selectedImportFiles.length} file{selectedImportFiles.length !== 1 ? "s" : ""} selected
                          </span>
                        )}
                        <button
                          type="button"
                          className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
                          disabled={selectedImportFiles.length === 0 || isImporting}
                          onClick={() => { void handleImportFiles(); }}
                        >
                          Import files
                        </button>
                      </div>
                    </div>

                    {/* Active jobs */}
                    <section aria-label="Active jobs">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-3">
                        Active jobs
                      </p>
                      {isKbJobsLoading ? (
                        <p className="text-sm text-stone-500">Loading…</p>
                      ) : kbJobList.active.length === 0 ? (
                        <p className="text-sm text-stone-400">No active import jobs.</p>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {kbJobList.active.map((job) => (
                            <li
                              key={job.job_id}
                              className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3"
                            >
                              <span className="text-sm text-stone-700">
                                {job.file_count} file{job.file_count !== 1 ? "s" : ""} &mdash; {job.status}
                              </span>
                              {job.status === "queued" && (
                                <button
                                  type="button"
                                  aria-label="Cancel job"
                                  className="text-xs text-rose-500 hover:underline"
                                  onClick={() => { void handleCancelJob(job.job_id); }}
                                >
                                  Cancel
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {/* Job history */}
                    <section aria-label="Job history">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-3">
                        Job history
                      </p>
                      {kbJobList.history.length === 0 ? (
                        <p className="text-sm text-stone-400">No job history yet.</p>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {kbJobList.history.map((job) => (
                            <li
                              key={job.job_id}
                              className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3"
                            >
                              <span className="text-sm text-stone-700">
                                {job.file_count} file{job.file_count !== 1 ? "s" : ""} &mdash; {job.status}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {kbJobList.history_total > kbJobList.history.length && (
                        <button
                          type="button"
                          className="mt-3 text-sm text-stone-500 hover:text-stone-700"
                          onClick={() => {
                            void loadKbJobs(activeWorkspace.workspace_id, kbJobList.history_page + 1);
                          }}
                        >
                          Load more history
                        </button>
                      )}
                    </section>
                  </div>
                </section>

                <div className="composer settings-actions border-t border-stone-200/80 bg-[rgba(255,248,242,0.88)] px-5 py-4 md:px-8">
                  <div className="settings-actions-row mx-auto flex w-full max-w-4xl justify-end gap-3">
                    <button
                      type="button"
                      className="secondary-button rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 text-sm font-medium text-stone-700 transition duration-200 hover:border-rose-200 hover:text-rose-500"
                      onClick={backToWorkspaceSettingsFromKnowledgeBaseManagement}
                    >
                      Back to Workspace Settings
                    </button>
                  </div>
                </div>
              </>
            ) : isSettingsOpen && settingsDraft && settingsWorkspace ? (
              <>
                <section className="messages settings-panel chat-scrollbar overflow-y-auto px-5 py-5 md:px-8">
                  <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 rounded-[2rem] border border-white/80 bg-white/88 p-5 shadow-[0_20px_50px_rgba(28,25,23,0.08)] md:p-7">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                          Workspace-owned settings
                        </p>
                        <h3 className="mt-2 font-['Iowan_Old_Style','Palatino_Linotype','Noto_Serif_TC',serif] text-2xl font-semibold tracking-[-0.03em] text-stone-950">
                          Tune tone, instructions, model behavior, and retrieval defaults
                        </h3>
                      </div>
                      <div className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">
                        Changes stay local until you save
                      </div>
                    </div>

                    <div className="settings-tabs flex flex-wrap gap-2" role="tablist" aria-label="Workspace settings tabs">
                      <button
                        type="button"
                        className={cn(
                          "settings-tab rounded-full px-4 py-2 text-sm font-medium transition duration-200",
                          activeSettingsTab === "general"
                            ? "active bg-stone-950 text-stone-50"
                            : "bg-stone-100 text-stone-600 hover:bg-rose-50 hover:text-rose-600",
                        )}
                        role="tab"
                        aria-selected={activeSettingsTab === "general"}
                        onClick={() => setActiveSettingsTab("general")}
                      >
                        General
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "settings-tab rounded-full px-4 py-2 text-sm font-medium transition duration-200",
                          activeSettingsTab === "model"
                            ? "active bg-stone-950 text-stone-50"
                            : "bg-stone-100 text-stone-600 hover:bg-rose-50 hover:text-rose-600",
                        )}
                        role="tab"
                        aria-selected={activeSettingsTab === "model"}
                        onClick={() => setActiveSettingsTab("model")}
                      >
                        Model
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "settings-tab rounded-full px-4 py-2 text-sm font-medium transition duration-200",
                          activeSettingsTab === "knowledgeBase"
                            ? "active bg-stone-950 text-stone-50"
                            : "bg-stone-100 text-stone-600 hover:bg-rose-50 hover:text-rose-600",
                        )}
                        role="tab"
                        aria-selected={activeSettingsTab === "knowledgeBase"}
                        onClick={() => setActiveSettingsTab("knowledgeBase")}
                      >
                        Knowledge Base
                      </button>
                    </div>

                    {activeSettingsTab === "general" ? (
                      <div className="grid gap-5">
                        <div className="settings-field">
                          <label htmlFor="workspace-name-input" className="mb-2 block text-sm font-medium text-stone-700">
                            Workspace Name
                          </label>
                          <input
                            id="workspace-name-input"
                            className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
                            value={settingsDraft.name}
                            onChange={(nextEvent) =>
                              setSettingsDraft((current) =>
                                current === null ? current : { ...current, name: nextEvent.target.value },
                              )
                            }
                            aria-label="Workspace Name"
                          />
                          {settingsValidationErrors.name ? (
                            <div className="field-error mt-2 text-sm text-rose-700">{settingsValidationErrors.name}</div>
                          ) : null}
                        </div>

                        <div className="settings-field">
                          <label htmlFor="system-message-input" className="mb-2 block text-sm font-medium text-stone-700">
                            System Message
                          </label>
                          <textarea
                            id="system-message-input"
                            className="min-h-56 w-full rounded-[1.5rem] border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
                            value={settingsDraft.systemMessage}
                            onChange={(nextEvent) =>
                              setSettingsDraft((current) =>
                                current === null ? current : { ...current, systemMessage: nextEvent.target.value },
                              )
                            }
                            aria-label="System Message"
                          />
                          {settingsValidationErrors.systemMessage ? (
                            <div className="field-error mt-2 text-sm text-rose-700">{settingsValidationErrors.systemMessage}</div>
                          ) : null}
                        </div>
                      </div>
                    ) : activeSettingsTab === "model" ? (
                      <div className="grid gap-5">
                        <div className="settings-field">
                          <label htmlFor="selected-model-input" className="mb-2 block text-sm font-medium text-stone-700">
                            Selected Model
                          </label>
                          <select
                            id="selected-model-input"
                            className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
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
                            <div className="field-error mt-2 text-sm text-rose-700">{settingsValidationErrors.selectedModelId}</div>
                          ) : null}
                        </div>

                        {settingsSelectedModel ? (
                          Object.entries(settingsSelectedModel.settings_schema).map(([settingKey, schema]) => (
                            <div key={settingKey} className="settings-field">
                              <label htmlFor={`model-setting-${settingKey}`} className="mb-2 block text-sm font-medium text-stone-700">
                                {schema.label}
                              </label>
                              {schema.type === "number" ? (
                                <input
                                  id={`model-setting-${settingKey}`}
                                  className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
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
                                  className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
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
                              {schema.help_text ? (
                                <div className="settings-hint mt-2 text-sm text-stone-500">{schema.help_text}</div>
                              ) : null}
                              {settingsValidationErrors.modelSettings[settingKey] ? (
                                <div className="field-error mt-2 text-sm text-rose-700">
                                  {settingsValidationErrors.modelSettings[settingKey]}
                                </div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <div className="settings-hint rounded-[1.25rem] border border-dashed border-stone-300 bg-stone-50/80 px-4 py-4 text-sm text-stone-500">
                            Select an enabled model to review the available Model-specific Settings.
                          </div>
                        )}
                      </div>
                    ) : isKnowledgeBaseSettingsLoading && knowledgeBaseSettingsDraft === null ? (
                      <div className="settings-hint rounded-[1.25rem] border border-dashed border-stone-300 bg-stone-50/80 px-4 py-4 text-sm text-stone-500">
                        Loading Knowledge Base Settings...
                      </div>
                    ) : knowledgeBaseSettingsDraft ? (
                      <div className="grid gap-5">
                        {knowledgeBaseSettingsDraft.rebuildRequired ? (
                          <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                            <div className="font-semibold">Rebuild Required</div>
                            <div className="mt-1">
                              Chunking settings changed. Rebuild the Knowledge Base when you're ready.
                            </div>
                          </div>
                        ) : null}

                        <div className="settings-field">
                          <label htmlFor="kb-chunk-size-input" className="mb-2 block text-sm font-medium text-stone-700">
                            Chunk Size
                          </label>
                          <input
                            id="kb-chunk-size-input"
                            className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
                            type="number"
                            min={1}
                            step={1}
                            value={String(knowledgeBaseSettingsDraft.chunkSize)}
                            onChange={(nextEvent) => updateKnowledgeBaseSetting("chunkSize", nextEvent.target.value)}
                            aria-label="Chunk Size"
                          />
                          {knowledgeBaseSettingsValidationErrors.chunkSize ? (
                            <div className="field-error mt-2 text-sm text-rose-700">
                              {knowledgeBaseSettingsValidationErrors.chunkSize}
                            </div>
                          ) : null}
                        </div>

                        <div className="settings-field">
                          <label htmlFor="kb-chunk-overlap-input" className="mb-2 block text-sm font-medium text-stone-700">
                            Chunk Overlap
                          </label>
                          <input
                            id="kb-chunk-overlap-input"
                            className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
                            type="number"
                            min={0}
                            step={1}
                            value={String(knowledgeBaseSettingsDraft.chunkOverlap)}
                            onChange={(nextEvent) => updateKnowledgeBaseSetting("chunkOverlap", nextEvent.target.value)}
                            aria-label="Chunk Overlap"
                          />
                          {knowledgeBaseSettingsValidationErrors.chunkOverlap ? (
                            <div className="field-error mt-2 text-sm text-rose-700">
                              {knowledgeBaseSettingsValidationErrors.chunkOverlap}
                            </div>
                          ) : null}
                        </div>

                        <div className="settings-field">
                          <label htmlFor="kb-top-k-input" className="mb-2 block text-sm font-medium text-stone-700">
                            Top K
                          </label>
                          <input
                            id="kb-top-k-input"
                            className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
                            type="number"
                            min={1}
                            step={1}
                            value={String(knowledgeBaseSettingsDraft.retrievalTopK)}
                            onChange={(nextEvent) => updateKnowledgeBaseSetting("retrievalTopK", nextEvent.target.value)}
                            aria-label="Top K"
                          />
                          {knowledgeBaseSettingsValidationErrors.retrievalTopK ? (
                            <div className="field-error mt-2 text-sm text-rose-700">
                              {knowledgeBaseSettingsValidationErrors.retrievalTopK}
                            </div>
                          ) : null}
                        </div>

                        <div className="settings-field">
                          <label htmlFor="kb-similarity-threshold-input" className="mb-2 block text-sm font-medium text-stone-700">
                            Similarity Threshold
                          </label>
                          <input
                            id="kb-similarity-threshold-input"
                            className="w-full rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition duration-200 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-200/60"
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={String(knowledgeBaseSettingsDraft.similarityThreshold)}
                            onChange={(nextEvent) => updateKnowledgeBaseSetting("similarityThreshold", nextEvent.target.value)}
                            aria-label="Similarity Threshold"
                          />
                          {knowledgeBaseSettingsValidationErrors.similarityThreshold ? (
                            <div className="field-error mt-2 text-sm text-rose-700">
                              {knowledgeBaseSettingsValidationErrors.similarityThreshold}
                            </div>
                          ) : null}
                        </div>

                        <label className="flex items-center gap-3 rounded-[1.25rem] border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-700">
                          <input
                            type="checkbox"
                            checked={knowledgeBaseSettingsDraft.knowledgeAnsweringDefault}
                            onChange={(nextEvent) =>
                              setKnowledgeBaseSettingsDraft((current) =>
                                current === null
                                  ? current
                                  : { ...current, knowledgeAnsweringDefault: nextEvent.target.checked },
                              )
                            }
                            aria-label="Knowledge Answering Default"
                          />
                          <span>Knowledge Answering Default</span>
                        </label>

                        <div className="rounded-[1.25rem] border border-stone-200 bg-[#f6efe6] px-4 py-4 text-sm text-stone-600">
                          Use this tab for workspace-owned retrieval defaults, then switch to management for files and jobs.
                        </div>

                        <div>
                          <button
                            type="button"
                            className="secondary-button rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 text-sm font-medium text-stone-700 transition duration-200 hover:border-rose-200 hover:text-rose-500"
                            onClick={openKnowledgeBaseManagement}
                          >
                            Open Knowledge Base Management
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="settings-hint rounded-[1.25rem] border border-dashed border-stone-300 bg-stone-50/80 px-4 py-4 text-sm text-stone-500">
                        Knowledge Base Settings are unavailable right now.
                      </div>
                    )}

                    <div className="settings-hint rounded-[1.25rem] border border-stone-200 bg-[#f6efe6] px-4 py-3 text-sm text-stone-600">
                      Pending settings stay local until you explicitly save them for future turns.
                    </div>
                  </div>
                </section>

                <div className="composer settings-actions border-t border-stone-200/80 bg-[rgba(255,248,242,0.88)] px-5 py-4 md:px-8">
                  <div className="settings-actions-row mx-auto flex w-full max-w-4xl justify-end gap-3">
                    <button
                      type="button"
                      className="secondary-button rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 text-sm font-medium text-stone-700 transition duration-200 hover:border-rose-200 hover:text-rose-500"
                      onClick={closeWorkspaceSettings}
                    >
                      Back to chat
                    </button>
                    <button
                      type="button"
                      className="primary-button rounded-2xl bg-stone-950 px-4 py-3 text-sm font-medium text-white shadow-[0_16px_30px_rgba(24,24,27,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
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
                <section className="messages chat-scrollbar overflow-y-auto px-5 py-5 md:px-8">
                  {activeMessages.length === 0 ? (
                    <div className="empty-state mx-auto flex min-h-full w-full max-w-3xl items-center justify-center">
                      <div className="w-full rounded-[2rem] border border-white/80 bg-white/82 p-8 shadow-[0_20px_50px_rgba(28,25,23,0.08)]">
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                              Playground mode
                            </p>
                            <h3 className="mt-3 font-['Iowan_Old_Style','Palatino_Linotype','Noto_Serif_TC',serif] text-3xl font-semibold tracking-[-0.03em] text-stone-950">
                              {activeWorkspace
                                ? isGenerationBlocked
                                  ? "這個 Workspace 目前無法送出新對話"
                                  : "\u958b\u59cb\u4e00\u6bb5\u65b0\u5c0d\u8a71"
                                : "\u5148\u5efa\u7acb\u5de5\u4f5c\u5340"}
                            </h3>
                            <p className="mt-4 max-w-xl text-sm leading-7 text-stone-600">
                              {activeWorkspace
                                ? isGenerationBlocked
                                  ? "Selected Model is disabled for new generation. Open Workspace Settings and choose an enabled model."
                                  : "\u7b2c\u4e00\u53e5 User Prompt \u9001\u51fa\u5f8c\u624d\u6703\u5728\u9019\u500b Workspace \u5efa\u7acb Conversation\u3002"
                                : "\u5de6\u5074\u8f38\u5165 Workspace Name \u4e26\u5efa\u7acb\uff0c\u518d\u958b\u59cb\u5c0d\u8a71\u3002"}
                            </p>
                          </div>
                          <div className="space-y-3 rounded-[1.5rem] border border-stone-200 bg-[#f6efe6] p-4 text-sm text-stone-600">
                            <div className="rounded-[1rem] bg-white/80 px-3 py-3">
                              Streaming text appears directly in chat.
                            </div>
                            <div className="rounded-[1rem] bg-white/80 px-3 py-3">
                              Workspace settings keep tone and model scoped together.
                            </div>
                            <div className="rounded-[1rem] bg-white/80 px-3 py-3">
                              Active streams continue even if you browse elsewhere.
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
                      {activeMessages.map((message) => (
                        <div
                          key={message.id}
                          className={cn(
                            "message-row flex",
                            message.role === "user" ? "user justify-end" : "assistant justify-start",
                          )}
                        >
                          <div className={cn("max-w-[88%] md:max-w-[78%]", message.role === "user" ? "items-end" : "items-start")}>
                            <div
                              className={cn(
                                "mb-2 text-[11px] font-semibold uppercase tracking-[0.16em]",
                                message.role === "user" ? "text-right text-stone-500" : "text-stone-400",
                              )}
                            >
                              {message.role === "user" ? "User prompt" : "Assistant"}
                            </div>
                            <div
                              className={cn(
                                "message-bubble rounded-[1.75rem] border px-5 py-4 text-[15px] leading-7 shadow-[0_18px_36px_rgba(28,25,23,0.05)]",
                                message.status === "streaming" && "streaming",
                                message.role === "user"
                                  ? "border-stone-950 bg-stone-950 text-stone-50"
                                  : "border-white/80 bg-white/92 text-stone-800",
                              )}
                            >
                              <div>{message.content || (message.status === "streaming" ? " " : "")}</div>
                              {message.status === "stopped" ? (
                                <div className="message-status mt-3 text-xs font-medium uppercase tracking-[0.14em] text-amber-700">
                                  {"\u5df2\u4e2d\u65b7"}
                                </div>
                              ) : null}
                              {message.status === "error" ? (
                                <div className="message-status mt-3 text-xs font-medium uppercase tracking-[0.14em] text-rose-700">
                                  {"\u767c\u751f\u932f\u8aa4"}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <div className="composer border-t border-stone-200/80 bg-[rgba(255,248,242,0.9)] px-5 py-4 md:px-8 md:py-5">
                  <div className="mx-auto w-full max-w-4xl">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      {activeWorkspace ? (
                        <>
                          <span className="rounded-full border border-stone-200 bg-white/90 px-3 py-1">
                            {activeWorkspace.name}
                          </span>
                          <span className="rounded-full border border-stone-200 bg-white/90 px-3 py-1">
                            {activeWorkspace.selected_model.label}
                          </span>
                        </>
                      ) : (
                        <span className="rounded-full border border-dashed border-stone-300 bg-white/80 px-3 py-1">
                          Choose a workspace to begin
                        </span>
                      )}
                    </div>
                    <form className="composer-form grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleSubmit}>
                      <textarea
                        className="min-h-32 w-full rounded-[1.75rem] border border-stone-200 bg-white px-5 py-4 text-[15px] text-stone-900 outline-none transition duration-200 placeholder:text-stone-400 focus:border-rose-300 focus:ring-4 focus:ring-rose-200/60 disabled:cursor-not-allowed disabled:bg-stone-100"
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

                      <div className="composer-actions flex items-end justify-end gap-3 md:min-w-[8rem]">
                        {showStopButton ? (
                          <button
                            type="button"
                            className="icon-button stop inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-[0_16px_30px_rgba(244,63,94,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-rose-600 focus:outline-none focus:ring-4 focus:ring-rose-200/70"
                            onClick={() => void stopStreaming()}
                            aria-label="Stop response"
                          >
                            <StopIcon className="h-5 w-5" />
                          </button>
                        ) : null}

                        {showSendButton ? (
                          <button
                            type="submit"
                            className="icon-button inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-950 text-white shadow-[0_16px_30px_rgba(24,24,27,0.22)] transition duration-200 hover:-translate-y-0.5 hover:bg-rose-500 focus:outline-none focus:ring-4 focus:ring-rose-200/70"
                            aria-label="Send message"
                          >
                            <SendIcon className="h-5 w-5" />
                          </button>
                        ) : null}
                      </div>
                    </form>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
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
