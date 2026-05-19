import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import {
  archiveWorkspace,
  cancelImportJob,
  createImportJob,
  createRebuildJob,
  createWorkspace,
  deleteKnowledgeBaseDocument,
  deleteConversation,
  getDefaultWorkspaceModel,
  getKnowledgeBaseSettings,
  getConversation,
  listKnowledgeBaseDocuments,
  listArchivedWorkspaces,
  listKnowledgeBaseJobs,
  listModels,
  listWorkspaceConversations,
  listWorkspaces,
  openChatStream,
  reorderWorkspaces,
  restoreWorkspace,
  stopConversation,
  updateKnowledgeBaseSettings,
  updateWorkspace,
} from "./api";
import { readSseStream } from "./lib/sse";

vi.mock("./api", () => ({
  archiveWorkspace: vi.fn(),
  cancelImportJob: vi.fn(),
  createImportJob: vi.fn(),
  createRebuildJob: vi.fn(),
  createWorkspace: vi.fn(),
  deleteKnowledgeBaseDocument: vi.fn(),
  deleteConversation: vi.fn(),
  getDefaultWorkspaceModel: vi.fn(),
  getKnowledgeBaseSettings: vi.fn(),
  getConversation: vi.fn(),
  listKnowledgeBaseDocuments: vi.fn(),
  listArchivedWorkspaces: vi.fn(),
  listKnowledgeBaseJobs: vi.fn(),
  listModels: vi.fn(),
  listWorkspaceConversations: vi.fn(),
  listWorkspaces: vi.fn(),
  openChatStream: vi.fn(),
  reorderWorkspaces: vi.fn(),
  restoreWorkspace: vi.fn(),
  stopConversation: vi.fn(),
  updateKnowledgeBaseSettings: vi.fn(),
  updateWorkspace: vi.fn(),
  toChatBubbles: (messages: Array<{ id: number; query: string; response: string; status: string }>) =>
    messages.flatMap((message) => [
      {
        id: `user-${message.id}`,
        role: "user",
        content: message.query,
        status: "completed",
      },
      {
        id: `assistant-${message.id}`,
        role: "assistant",
        content: message.response,
        status:
          message.status === "completed" || message.status === "stopped" || message.status === "error"
            ? message.status
            : "streaming",
      },
    ]),
}));

vi.mock("./lib/sse", () => ({
  readSseStream: vi.fn(),
}));

const mockedCancelImportJob = vi.mocked(cancelImportJob);
const mockedCreateImportJob = vi.mocked(createImportJob);
const mockedCreateRebuildJob = vi.mocked(createRebuildJob);
const mockedCreateWorkspace = vi.mocked(createWorkspace);
const mockedDeleteKnowledgeBaseDocument = vi.mocked(deleteKnowledgeBaseDocument);
const mockedDeleteConversation = vi.mocked(deleteConversation);
const mockedGetDefaultWorkspaceModel = vi.mocked(getDefaultWorkspaceModel);
const mockedGetKnowledgeBaseSettings = vi.mocked(getKnowledgeBaseSettings);
const mockedGetConversation = vi.mocked(getConversation);
const mockedArchiveWorkspace = vi.mocked(archiveWorkspace);
const mockedListKnowledgeBaseDocuments = vi.mocked(listKnowledgeBaseDocuments);
const mockedListArchivedWorkspaces = vi.mocked(listArchivedWorkspaces);
const mockedListKnowledgeBaseJobs = vi.mocked(listKnowledgeBaseJobs);
const mockedListModels = vi.mocked(listModels);
const mockedListWorkspaceConversations = vi.mocked(listWorkspaceConversations);
const mockedListWorkspaces = vi.mocked(listWorkspaces);
const mockedOpenChatStream = vi.mocked(openChatStream);
const mockedReorderWorkspaces = vi.mocked(reorderWorkspaces);
const mockedRestoreWorkspace = vi.mocked(restoreWorkspace);
const mockedStopConversation = vi.mocked(stopConversation);
const mockedUpdateKnowledgeBaseSettings = vi.mocked(updateKnowledgeBaseSettings);
const mockedUpdateWorkspace = vi.mocked(updateWorkspace);
const mockedReadSseStream = vi.mocked(readSseStream);

describe("App", () => {
  beforeEach(() => {
    mockedArchiveWorkspace.mockReset();
    mockedCancelImportJob.mockReset();
    mockedCreateImportJob.mockReset();
    mockedCreateRebuildJob.mockReset();
    mockedCreateWorkspace.mockReset();
    mockedDeleteKnowledgeBaseDocument.mockReset();
    mockedDeleteConversation.mockReset();
    mockedGetDefaultWorkspaceModel.mockReset();
    mockedGetKnowledgeBaseSettings.mockReset();
    mockedGetConversation.mockReset();
    mockedListKnowledgeBaseDocuments.mockReset();
    mockedListArchivedWorkspaces.mockReset();
    mockedListKnowledgeBaseJobs.mockReset();
    mockedListModels.mockReset();
    mockedListWorkspaceConversations.mockReset();
    mockedListWorkspaces.mockReset();
    mockedOpenChatStream.mockReset();
    mockedReorderWorkspaces.mockReset();
    mockedRestoreWorkspace.mockReset();
    mockedStopConversation.mockReset();
    mockedUpdateKnowledgeBaseSettings.mockReset();
    mockedUpdateWorkspace.mockReset();
    mockedReadSseStream.mockReset();
    mockedListArchivedWorkspaces.mockResolvedValue([]);
    mockedListKnowledgeBaseDocuments.mockResolvedValue({ documents: [] });
    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [],
      history: [],
      history_total: 0,
      history_page: 1,
    });
    mockedGetKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-default",
      chunk_size: 800,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: false,
      rebuild_required: false,
    });
    mockedUpdateKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-default",
      chunk_size: 800,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: false,
      rebuild_required: false,
    });
    mockedStopConversation.mockResolvedValue(undefined);
    mockedDeleteConversation.mockResolvedValue(undefined);
    mockedListModels.mockResolvedValue([
      {
        model_id: "gpt-5.4-mini",
        label: "GPT 5.4 Mini",
        is_enabled: true,
        is_default_workspace_model: true,
        supports_system_message: true,
        settings_schema: {
          temperature: {
            type: "number",
            label: "Temperature",
            min: 0,
            max: 2,
            step: 0.1,
            help_text: "Higher values make replies more exploratory.",
          },
          reasoning_effort: {
            type: "enum",
            label: "Reasoning effort",
            options: [
              { value: "minimal", label: "Minimal" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
            help_text: "Controls how much reasoning budget the model uses.",
          },
        },
        settings_defaults: {
          temperature: 1,
          reasoning_effort: "medium",
        },
        sort_order: 0,
      },
      {
        model_id: "gpt-5.4-nano",
        label: "GPT 5.4 Nano",
        is_enabled: true,
        is_default_workspace_model: false,
        supports_system_message: true,
        settings_schema: {
          temperature: {
            type: "number",
            label: "Temperature",
            min: 0,
            max: 2,
            step: 0.1,
            help_text: "Higher values make replies more exploratory.",
          },
        },
        settings_defaults: {
          temperature: 0.7,
        },
        sort_order: 1,
      },
    ]);
  });

  it("moves archived workspaces into an archived view and restores them before reuse", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-alpha",
        name: "Workspace Alpha",
        system_message: "Alpha system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
      {
        workspace_id: "ws-beta",
        name: "Workspace Beta",
        system_message: "Beta system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:01:00Z",
        updated_at: "2026-05-15T00:01:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);
    mockedArchiveWorkspace.mockResolvedValue({
      workspace_id: "ws-alpha",
      name: "Workspace Alpha",
      system_message: "Alpha system",
      selected_model: {
        model_id: "gpt-5.4-nano",
        label: "gpt-5.4-nano",
        is_enabled: true,
        is_default_workspace_model: true,
      },
      model_settings: {
        temperature: 0.7,
      },
      created_at: "2026-05-15T00:00:00Z",
      updated_at: "2026-05-15T00:05:00Z",
    });
    mockedRestoreWorkspace.mockResolvedValue({
      workspace_id: "ws-alpha",
      name: "Workspace Alpha",
      system_message: "Alpha system",
      selected_model: {
        model_id: "gpt-5.4-nano",
        label: "gpt-5.4-nano",
        is_enabled: true,
        is_default_workspace_model: true,
      },
      model_settings: {
        temperature: 0.7,
      },
      created_at: "2026-05-15T00:00:00Z",
      updated_at: "2026-05-15T00:06:00Z",
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace Alpha gpt-5.4-nano" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive Workspace Alpha" }));

    expect(mockedArchiveWorkspace).toHaveBeenCalledWith("ws-alpha");
    expect(screen.queryByRole("button", { name: "Workspace Alpha gpt-5.4-nano" })).not.toBeInTheDocument();
    expect(screen.getByText("Archived Workspaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Workspace Alpha" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore Workspace Alpha" }));

    expect(mockedRestoreWorkspace).toHaveBeenCalledWith("ws-alpha");
    expect(await screen.findByRole("button", { name: "Workspace Alpha gpt-5.4-nano" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore Workspace Alpha" })).not.toBeInTheDocument();
  });

  it("persists manual workspace ordering after a move action", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-alpha",
        name: "Workspace Alpha",
        system_message: "Alpha system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        sort_order: 0,
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
      {
        workspace_id: "ws-beta",
        name: "Workspace Beta",
        system_message: "Beta system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        sort_order: 1,
        created_at: "2026-05-15T00:01:00Z",
        updated_at: "2026-05-15T00:01:00Z",
      },
      {
        workspace_id: "ws-gamma",
        name: "Workspace Gamma",
        system_message: "Gamma system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        sort_order: 2,
        created_at: "2026-05-15T00:02:00Z",
        updated_at: "2026-05-15T00:02:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);
    mockedReorderWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-beta",
        name: "Workspace Beta",
        system_message: "Beta system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        sort_order: 0,
        created_at: "2026-05-15T00:01:00Z",
        updated_at: "2026-05-15T00:03:00Z",
      },
      {
        workspace_id: "ws-alpha",
        name: "Workspace Alpha",
        system_message: "Alpha system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        sort_order: 1,
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:03:00Z",
      },
      {
        workspace_id: "ws-gamma",
        name: "Workspace Gamma",
        system_message: "Gamma system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        sort_order: 2,
        created_at: "2026-05-15T00:02:00Z",
        updated_at: "2026-05-15T00:03:00Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace Alpha gpt-5.4-nano" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move up Workspace Beta" }));

    expect(mockedReorderWorkspaces).toHaveBeenCalledWith(["ws-beta", "ws-alpha", "ws-gamma"]);

    const orderedWorkspaceNames = Array.from(
      document.querySelectorAll(".workspace-row > .conversation-item"),
      (element) => element.querySelector("strong")?.textContent,
    ).filter((value): value is string => Boolean(value));

    expect(orderedWorkspaceNames.slice(0, 3)).toEqual([
      "Workspace Beta",
      "Workspace Alpha",
      "Workspace Gamma",
    ]);
  });

  it("loads workspace-scoped conversations and switches between workspaces", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-alpha",
        name: "Workspace Alpha",
        system_message: "Alpha system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
      {
        workspace_id: "ws-beta",
        name: "Workspace Beta",
        system_message: "Beta system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        created_at: "2026-05-15T00:01:00Z",
        updated_at: "2026-05-15T00:01:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockImplementation(async (workspaceId: string) => {
      if (workspaceId === "ws-alpha") {
        return [
          {
            workspace_id: "ws-alpha",
            conversation_id: "conv-alpha",
            conversation_title: "Alpha convo",
            updated_at: "2026-05-15T00:02:00Z",
          },
        ];
      }
      return [
        {
          workspace_id: "ws-beta",
          conversation_id: "conv-beta",
          conversation_title: "Beta convo",
          updated_at: "2026-05-15T00:03:00Z",
        },
      ];
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace Alpha gpt-5.4-nano" })).toBeInTheDocument();
    expect(await screen.findByText("Alpha convo")).toBeInTheDocument();
    expect(mockedListWorkspaceConversations).toHaveBeenCalledWith("ws-alpha");

    await user.click(screen.getByRole("button", { name: "Workspace Beta gpt-5.4-nano" }));

    expect(await screen.findByText("Beta convo")).toBeInTheDocument();
    expect(mockedListWorkspaceConversations).toHaveBeenCalledWith("ws-beta");
  });

  it("creates a workspace and sends the first prompt with that workspace id", async () => {
    const user = userEvent.setup();
    let conversationCreated = false;

    mockedListWorkspaces.mockResolvedValue([]);
    mockedGetDefaultWorkspaceModel.mockResolvedValue({
      model_id: "gpt-5.4-nano",
      label: "GPT 5.4 Nano",
      is_enabled: true,
      is_default_workspace_model: true,
    });
    mockedListWorkspaceConversations.mockImplementation(async () =>
      conversationCreated
        ? [
            {
              workspace_id: "ws-new",
              conversation_id: "conv-1",
              conversation_title: "第一句話",
              updated_at: "2026-05-15T00:01:00Z",
            },
          ]
        : [],
    );
    mockedCreateWorkspace.mockResolvedValue({
      workspace_id: "ws-new",
      name: "New Workspace",
      system_message: "Workspace system",
      selected_model: {
        model_id: "gpt-5.4-nano",
        label: "gpt-5.4-nano",
        is_enabled: true,
        is_default_workspace_model: true,
      },
      created_at: "2026-05-15T00:00:00Z",
      updated_at: "2026-05-15T00:00:00Z",
    });
    mockedOpenChatStream.mockResolvedValue({ body: {} as ReadableStream<Uint8Array> } as Response);
    mockedReadSseStream.mockImplementation(async (_body, onEvent) => {
      conversationCreated = true;
      onEvent({
        event: "conversation.created",
        data: {
          workspace_id: "ws-new",
          conversation_id: "conv-1",
          conversation_title: "第一句話",
        },
      });
      onEvent({ event: "message.created", data: { message_id: 1 } });
      onEvent({ event: "message.delta", data: { delta: "Hello" } });
      onEvent({ event: "message.done", data: { status: "completed" } });
    });

    render(<App />);

    expect(await screen.findByText("預設模型")).toBeInTheDocument();
    expect(screen.getByText("GPT 5.4 Nano")).toBeInTheDocument();

    await user.type(screen.getByLabelText("工作區名稱"), "New Workspace");
    await user.click(screen.getByLabelText("建立工作區"));

    expect(await screen.findByRole("button", { name: "New Workspace gpt-5.4-nano" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("訊息輸入框"), "第一句話");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockedOpenChatStream).toHaveBeenCalledWith(
      {
        workspace_id: "ws-new",
        conversation_id: 0,
        message_id: 0,
        message: "第一句話",
        knowledge_answering_enabled: false,
      },
      expect.any(AbortSignal),
    );
    expect(mockedGetDefaultWorkspaceModel).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /^第一句話/ })).toBeInTheDocument();
  });

  it("keeps a stopped bubble stopped even if a final delta arrives after abort", async () => {
    const user = userEvent.setup();
    let conversationCreated = false;

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-1",
        name: "Workspace One",
        system_message: "Workspace system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockImplementation(async () =>
      conversationCreated
        ? [
            {
              workspace_id: "ws-1",
              conversation_id: "conv-1",
              conversation_title: "停止測試",
              updated_at: "2026-05-15T00:01:00Z",
            },
          ]
        : [],
    );
    mockedOpenChatStream.mockResolvedValue({ body: {} as ReadableStream<Uint8Array> } as Response);
    mockedReadSseStream.mockImplementation(async (_body, onEvent, signal) => {
      conversationCreated = true;
      onEvent({
        event: "conversation.created",
        data: { workspace_id: "ws-1", conversation_id: "conv-1", conversation_title: "停止測試" },
      });
      onEvent({ event: "message.created", data: { message_id: 1 } });
      onEvent({ event: "message.delta", data: { delta: "Hello" } });

      await new Promise<never>((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            onEvent({ event: "message.delta", data: { delta: " world" } });
            reject(new DOMException("The operation was aborted.", "AbortError"));
          },
          { once: true },
        );
      });
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace One gpt-5.4-nano" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("訊息輸入框"), "Stop");
    await user.click(screen.getByLabelText("Send message"));

    expect(await screen.findByLabelText("Stop response")).toBeInTheDocument();
    expect(await screen.findByText("Hello")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Stop response"));

    await waitFor(() => expect(screen.queryByLabelText("Stop response")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("已中斷")).toBeInTheDocument());

    const bubble = screen.getByText("Hello world").closest(".message-bubble");
    expect(bubble).not.toHaveClass("streaming");
    expect(mockedStopConversation).toHaveBeenCalledWith("conv-1");
  });

  it("keeps active streams scoped to their conversation while navigating", async () => {
    const user = userEvent.setup();
    let releaseStream: (() => void) | null = null;
    let emitEvent: ((event: { event: string; data: Record<string, unknown> }) => void) | null = null;
    let conversationCreated = false;

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-alpha",
        name: "Workspace Alpha",
        system_message: "Workspace alpha system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
      {
        workspace_id: "ws-beta",
        name: "Workspace Beta",
        system_message: "Workspace beta system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:01:00Z",
        updated_at: "2026-05-15T00:01:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockImplementation(async (workspaceId: string) => {
      if (workspaceId === "ws-alpha" && conversationCreated) {
        return [
          {
            workspace_id: "ws-alpha",
            conversation_id: "conv-1",
            conversation_title: "背景串流",
            updated_at: "2026-05-15T00:02:00Z",
          },
        ];
      }
      return [];
    });
    mockedOpenChatStream.mockResolvedValue({ body: {} as ReadableStream<Uint8Array> } as Response);
    mockedReadSseStream.mockImplementation(async (_body, onEvent) => {
      conversationCreated = true;
      emitEvent = onEvent;
      onEvent({
        event: "conversation.created",
        data: { workspace_id: "ws-alpha", conversation_id: "conv-1", conversation_title: "背景串流" },
      });
      onEvent({ event: "message.created", data: { message_id: 1 } });
      onEvent({ event: "message.delta", data: { delta: "Hello" } });

      await new Promise<void>((resolve) => {
        releaseStream = () => {
          onEvent({ event: "message.done", data: { status: "completed" } });
          resolve();
        };
      });
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace Alpha gpt-5.4-nano" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("訊息輸入框"), "背景串流");
    await user.click(screen.getByLabelText("Send message"));

    expect(await screen.findByLabelText("Stop response")).toBeInTheDocument();
    expect(await screen.findByText("Hello")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Workspace Beta gpt-5.4-nano" }));

    await waitFor(() => expect(screen.queryByLabelText("Stop response")).not.toBeInTheDocument());
    expect(mockedStopConversation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Workspace Alpha gpt-5.4-nano" }));

    expect(await screen.findByText("Streaming")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stop response")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^背景串流/ }));

    expect(mockedGetConversation).not.toHaveBeenCalled();
    expect(await screen.findByText("Hello")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop response")).toBeInTheDocument();

    await act(async () => {
      emitEvent?.({ event: "message.delta", data: { delta: " world" } });
      releaseStream?.();
    });

    expect(await screen.findByText("Hello world")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText("Stop response")).not.toBeInTheDocument());
  });

  it("loads saved history when selecting an older conversation", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-older",
        name: "Workspace Older",
        system_message: "Workspace system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([
      {
        workspace_id: "ws-older",
        conversation_id: "conv-older",
        conversation_title: "較早的對話",
        updated_at: "2026-05-09T12:00:00Z",
      },
    ]);
    mockedGetConversation.mockResolvedValue({
      workspace_id: "ws-older",
      conversation_id: "conv-older",
      conversation_title: "較早的對話",
      created_at: "2026-05-09T12:00:00Z",
      updated_at: "2026-05-09T12:00:00Z",
      messages: [
        {
          id: 7,
          query: "舊問題",
          response: "舊回答",
          status: "completed",
          created_at: "2026-05-09T12:00:00Z",
          updated_at: "2026-05-09T12:00:00Z",
        },
      ],
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: /^較早的對話/ }));

    expect(await screen.findByText("舊問題")).toBeInTheDocument();
    expect(await screen.findByText("舊回答")).toBeInTheDocument();
  });

  it("initializes the composer knowledge toggle from workspace defaults and sends a one-turn override", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-kb-chat",
        name: "Workspace KB Chat",
        system_message: "Workspace system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedGetKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-kb-chat",
      chunk_size: 800,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: true,
      rebuild_required: false,
    });
    mockedListWorkspaceConversations.mockResolvedValue([]);
    mockedOpenChatStream.mockResolvedValue({ body: {} as ReadableStream<Uint8Array> } as Response);
    mockedReadSseStream.mockImplementation(async (_body, onEvent) => {
      onEvent({
        event: "conversation.created",
        data: { workspace_id: "ws-kb-chat", conversation_id: "conv-kb", conversation_title: "KB question" },
      });
      onEvent({ event: "message.created", data: { message_id: 1 } });
      onEvent({ event: "message.delta", data: { delta: "Hello" } });
      onEvent({
        event: "message.done",
        data: {
          status: "completed",
          knowledge_answering_requested: false,
          knowledge_answering_used: false,
          fallback_reason: null,
        },
      });
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace KB Chat gpt-5.4-nano" })).toBeInTheDocument();
    const knowledgeToggle = await screen.findByRole("checkbox", { name: "Knowledge Answering" });
    await waitFor(() => expect(knowledgeToggle).toBeChecked());

    await user.click(knowledgeToggle);
    expect(knowledgeToggle).not.toBeChecked();

    await user.type(screen.getByLabelText("訊息輸入框"), "KB question");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockedOpenChatStream).toHaveBeenCalledWith(
      {
        workspace_id: "ws-kb-chat",
        conversation_id: 0,
        message_id: 0,
        message: "KB question",
        knowledge_answering_enabled: false,
      },
      expect.any(AbortSignal),
    );

    await waitFor(() => expect(screen.queryByLabelText("Stop response")).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Knowledge Answering" })).toBeChecked();
  });

  it("shows a visible fallback note when knowledge answering cannot run for a turn", async () => {
    const user = userEvent.setup();
    let conversationCreated = false;

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-fallback",
        name: "Workspace Fallback",
        system_message: "Workspace system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedGetKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-fallback",
      chunk_size: 800,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: true,
      rebuild_required: false,
    });
    mockedListWorkspaceConversations.mockImplementation(async () =>
      conversationCreated
        ? [
            {
              workspace_id: "ws-fallback",
              conversation_id: "conv-fallback",
              conversation_title: "Fallback",
              updated_at: "2026-05-15T00:01:00Z",
            },
          ]
        : [],
    );
    mockedOpenChatStream.mockResolvedValue({ body: {} as ReadableStream<Uint8Array> } as Response);
    mockedReadSseStream.mockImplementation(async (_body, onEvent) => {
      conversationCreated = true;
      onEvent({
        event: "conversation.created",
        data: { workspace_id: "ws-fallback", conversation_id: "conv-fallback", conversation_title: "Fallback" },
      });
      onEvent({ event: "message.created", data: { message_id: 1 } });
      onEvent({ event: "message.delta", data: { delta: "Hello" } });
      onEvent({
        event: "message.done",
        data: {
          status: "completed",
          knowledge_answering_requested: true,
          knowledge_answering_used: false,
          fallback_reason: "knowledge_base_unavailable",
        },
      });
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace Fallback gpt-5.4-nano" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Knowledge Answering" })).toBeChecked(),
    );
    await user.type(screen.getByLabelText("訊息輸入框"), "Fallback");
    await user.click(screen.getByLabelText("Send message"));

    expect(await screen.findByText("Knowledge Answering unavailable for this turn. Fell back to chat.")).toBeInTheDocument();
  });

  it("renders sources beneath the assistant reply when a knowledge-backed turn succeeds", async () => {
    const user = userEvent.setup();
    let conversationCreated = false;

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-sources",
        name: "Workspace Sources",
        system_message: "Workspace system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedGetKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-sources",
      chunk_size: 800,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: true,
      rebuild_required: false,
    });
    mockedListWorkspaceConversations.mockImplementation(async () =>
      conversationCreated
        ? [
            {
              workspace_id: "ws-sources",
              conversation_id: "conv-sources",
              conversation_title: "Sources",
              updated_at: "2026-05-15T00:01:00Z",
            },
          ]
        : [],
    );
    mockedOpenChatStream.mockResolvedValue({ body: {} as ReadableStream<Uint8Array> } as Response);
    mockedReadSseStream.mockImplementation(async (_body, onEvent) => {
      conversationCreated = true;
      onEvent({
        event: "conversation.created",
        data: { workspace_id: "ws-sources", conversation_id: "conv-sources", conversation_title: "Sources" },
      });
      onEvent({ event: "message.created", data: { message_id: 1 } });
      onEvent({ event: "message.delta", data: { delta: "Answer grounded in docs." } });
      onEvent({
        event: "sources",
        data: {
          sources: [
            {
              knowledge_document_id: "doc-1",
              display_filename: "alpha-plan.md",
              revision_number: 3,
              chunk_count: 4,
              excerpt: "Milestones: kickoff, beta, launch.",
              score: 0.94,
            },
          ],
        },
      });
      onEvent({
        event: "message.done",
        data: {
          status: "completed",
          knowledge_answering_requested: true,
          knowledge_answering_used: true,
          fallback_reason: null,
        },
      });
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace Sources gpt-5.4-nano" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Knowledge Answering" })).toBeChecked(),
    );
    await user.type(screen.getByLabelText("訊息輸入框"), "Sources");
    await user.click(screen.getByLabelText("Send message"));

    expect((await screen.findAllByText("Sources")).length).toBeGreaterThan(0);
    expect(screen.getByText("alpha-plan.md")).toBeInTheDocument();
    expect(screen.getByText("Milestones: kickoff, beta, launch.")).toBeInTheDocument();
  });

  it("keeps general settings pending until explicit save and stays in settings after saving", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-settings",
        name: "Workspace Alpha",
        system_message: "Original system message",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);
    mockedUpdateWorkspace.mockResolvedValue({
      workspace_id: "ws-settings",
      name: "Workspace Renamed",
      system_message: "Saved system message",
      selected_model: {
        model_id: "gpt-5.4-nano",
        label: "gpt-5.4-nano",
        is_enabled: true,
        is_default_workspace_model: true,
      },
      model_settings: {
        temperature: 0.7,
      },
      created_at: "2026-05-15T00:00:00Z",
      updated_at: "2026-05-15T00:05:00Z",
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open workspace settings" }));
    expect(await screen.findByRole("heading", { name: "Workspace Settings" })).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Workspace Name");
    const systemMessageInput = screen.getByLabelText("System Message");

    await user.clear(nameInput);
    await user.type(nameInput, "Workspace Renamed");
    await user.clear(systemMessageInput);
    await user.type(systemMessageInput, "Saved system message");

    expect(screen.getByRole("button", { name: "Workspace Alpha gpt-5.4-nano" })).toBeInTheDocument();
    expect(mockedUpdateWorkspace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(mockedUpdateWorkspace).toHaveBeenCalledWith("ws-settings", {
      name: "Workspace Renamed",
      system_message: "Saved system message",
      selected_model_id: "gpt-5.4-nano",
      model_settings: {
        temperature: 0.7,
      },
    });
    expect(await screen.findByRole("heading", { name: "Workspace Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace Renamed gpt-5.4-nano" })).toBeInTheDocument();
  });

  it("warns before discarding pending general settings", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-alpha",
        name: "Workspace Alpha",
        system_message: "Alpha system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
      {
        workspace_id: "ws-beta",
        name: "Workspace Beta",
        system_message: "Beta system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        created_at: "2026-05-15T00:01:00Z",
        updated_at: "2026-05-15T00:01:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open workspace settings" }));
    await user.clear(screen.getByLabelText("Workspace Name"));
    await user.type(screen.getByLabelText("Workspace Name"), "Workspace Draft");

    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Workspace Beta gpt-5.4-nano" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Workspace Settings" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Workspace Draft")).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Workspace Beta gpt-5.4-nano" }));

    expect(await screen.findByText("開始一段新對話")).toBeInTheDocument();
    expect(screen.getByText("Workspace Beta | gpt-5.4-nano")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("renders model settings from the catalog and drops obsolete pending fields on model change", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-models",
        name: "Workspace Models",
        system_message: "Model system message",
        selected_model: {
          model_id: "gpt-5.4-mini",
          label: "GPT 5.4 Mini",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 1,
          reasoning_effort: "medium",
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);
    mockedUpdateWorkspace.mockResolvedValue({
      workspace_id: "ws-models",
      name: "Workspace Models",
      system_message: "Model system message",
      selected_model: {
        model_id: "gpt-5.4-nano",
        label: "GPT 5.4 Nano",
        is_enabled: true,
        is_default_workspace_model: false,
      },
      model_settings: {
        temperature: 0.4,
      },
      created_at: "2026-05-15T00:00:00Z",
      updated_at: "2026-05-15T00:05:00Z",
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open workspace settings" }));
    await user.click(screen.getByRole("tab", { name: "Model" }));

    expect(screen.getByLabelText("Selected Model")).toHaveValue("gpt-5.4-mini");
    expect(screen.getByLabelText("Temperature")).toHaveValue(1);
    expect(screen.getByLabelText("Reasoning effort")).toHaveValue("medium");

    await user.clear(screen.getByLabelText("Temperature"));
    await user.type(screen.getByLabelText("Temperature"), "0.4");
    await user.selectOptions(screen.getByLabelText("Reasoning effort"), "high");
    await user.selectOptions(screen.getByLabelText("Selected Model"), "gpt-5.4-nano");

    expect(screen.queryByLabelText("Reasoning effort")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(mockedUpdateWorkspace).toHaveBeenCalledWith("ws-models", {
      name: "Workspace Models",
      system_message: "Model system message",
      selected_model_id: "gpt-5.4-nano",
      model_settings: {
        temperature: 0.4,
      },
    });
  });

  it("keeps knowledge base settings pending until explicit save and shows rebuild required after ingestion changes", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-kb",
        name: "Workspace KB",
        system_message: "System message",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);
    mockedGetKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-kb",
      chunk_size: 800,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: false,
      rebuild_required: false,
    });
    mockedUpdateKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-kb",
      chunk_size: 1000,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: false,
      rebuild_required: true,
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open workspace settings" }));
    await user.click(screen.getByRole("tab", { name: "Knowledge Base" }));

    expect(mockedGetKnowledgeBaseSettings).toHaveBeenCalledWith("ws-kb");
    expect(await screen.findByLabelText("Chunk Size")).toHaveValue(800);
    expect(screen.getByLabelText("Chunk Overlap")).toHaveValue(200);

    await user.clear(screen.getByLabelText("Chunk Size"));
    await user.type(screen.getByLabelText("Chunk Size"), "1000");

    expect(mockedUpdateKnowledgeBaseSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(mockedUpdateWorkspace).not.toHaveBeenCalled();
    expect(mockedUpdateKnowledgeBaseSettings).toHaveBeenCalledWith("ws-kb", {
      chunk_size: 1000,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: false,
    });
    expect(await screen.findByText("Rebuild Required")).toBeInTheDocument();
    expect(screen.getByText("Chunking settings changed. Rebuild the Knowledge Base when you're ready.")).toBeInTheDocument();
  });

  it("opens knowledge base management with an empty-state shell from workspace settings", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-kb",
        name: "Workspace KB",
        system_message: "System message",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: {
          temperature: 0.7,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);
    mockedGetKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-kb",
      chunk_size: 800,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: false,
      rebuild_required: false,
    });
    mockedListKnowledgeBaseDocuments.mockResolvedValue({ documents: [] });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open workspace settings" }));
    await user.click(screen.getByRole("tab", { name: "Knowledge Base" }));
    await user.click(await screen.findByRole("button", { name: "Open Knowledge Base Management" }));

    expect(await screen.findByRole("heading", { name: "Knowledge Base Management" })).toBeInTheDocument();
    expect(screen.getByLabelText("Select files to import")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Active jobs" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to Workspace Settings" }));

    expect(await screen.findByRole("heading", { name: "Workspace Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Knowledge Base" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps a disabled model workspace readable but blocks new generation", async () => {
    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-disabled",
        name: "Workspace Disabled",
        system_message: "Disabled system message",
        selected_model: {
          model_id: "gpt-4.1-classic",
          label: "GPT 4.1 Classic",
          is_enabled: false,
          is_default_workspace_model: false,
        },
        model_settings: {
          temperature: 1,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("Selected Model is disabled for new generation. Open Workspace Settings and choose an enabled model.")).toBeInTheDocument();
    expect(screen.getByLabelText("訊息輸入框")).toBeDisabled();
    expect(screen.queryByLabelText("Send message")).not.toBeInTheDocument();
  });

  it("validates a non-blank system message before save", async () => {
    const user = userEvent.setup();

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-settings",
        name: "Workspace Alpha",
        system_message: "Original system message",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([]);

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open workspace settings" }));
    await user.clear(screen.getByLabelText("System Message"));
    await user.type(screen.getByLabelText("System Message"), "   ");

    expect(screen.getByText("System Message cannot be blank")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  });

  it("requires Delete Confirmation before permanently removing a Conversation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-1",
        name: "Workspace One",
        system_message: "system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: { temperature: 0.7 },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([
      {
        workspace_id: "ws-1",
        conversation_id: "conv-1",
        conversation_title: "Old Chat",
        updated_at: "2026-05-15T00:01:00Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText("Old Chat")).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Delete Old Chat" }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockedDeleteConversation).toHaveBeenCalledWith("conv-1"));
    expect(screen.queryByText("Old Chat")).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("cancels deletion when Delete Confirmation is dismissed", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-1",
        name: "Workspace One",
        system_message: "system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: { temperature: 0.7 },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockResolvedValue([
      {
        workspace_id: "ws-1",
        conversation_id: "conv-1",
        conversation_title: "Keep Chat",
        updated_at: "2026-05-15T00:01:00Z",
      },
    ]);

    render(<App />);

    expect(await screen.findByText("Keep Chat")).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "Delete Keep Chat" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockedDeleteConversation).not.toHaveBeenCalled();
    expect(screen.getByText("Keep Chat")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("stops Active Stream before deleting a streaming Conversation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    let conversationCreated = false;
    let releaseStream: (() => void) | null = null;

    mockedListWorkspaces.mockResolvedValue([
      {
        workspace_id: "ws-1",
        name: "Workspace One",
        system_message: "system",
        selected_model: {
          model_id: "gpt-5.4-nano",
          label: "gpt-5.4-nano",
          is_enabled: true,
          is_default_workspace_model: true,
        },
        model_settings: { temperature: 0.7 },
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ]);
    mockedListWorkspaceConversations.mockImplementation(async () =>
      conversationCreated
        ? [
            {
              workspace_id: "ws-1",
              conversation_id: "conv-stream",
              conversation_title: "Streaming Chat",
              updated_at: "2026-05-15T00:01:00Z",
            },
          ]
        : [],
    );
    mockedOpenChatStream.mockResolvedValue({ body: {} as ReadableStream<Uint8Array> } as Response);
    mockedReadSseStream.mockImplementation(async (_body, onEvent) => {
      conversationCreated = true;
      onEvent({
        event: "conversation.created",
        data: { workspace_id: "ws-1", conversation_id: "conv-stream", conversation_title: "Streaming Chat" },
      });
      onEvent({ event: "message.created", data: { message_id: 1 } });
      onEvent({ event: "message.delta", data: { delta: "Hello" } });
      await new Promise<void>((resolve) => {
        releaseStream = () => {
          onEvent({ event: "message.done", data: { status: "completed" } });
          resolve();
        };
      });
    });

    const callOrder: string[] = [];
    mockedStopConversation.mockImplementation(async () => {
      callOrder.push("stop");
    });
    mockedDeleteConversation.mockImplementation(async () => {
      callOrder.push("delete");
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Workspace One gpt-5.4-nano" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("訊息輸入框"), "Hello");
    await user.click(screen.getByLabelText("Send message"));

    expect(await screen.findByText("Streaming")).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Delete Streaming Chat" }));

    await waitFor(() => expect(mockedDeleteConversation).toHaveBeenCalledWith("conv-stream"));
    expect(mockedStopConversation).toHaveBeenCalledWith("conv-stream");
    expect(callOrder.indexOf("stop")).toBeLessThan(callOrder.indexOf("delete"));
    expect(screen.queryByText("Streaming Chat")).not.toBeInTheDocument();

    await act(async () => { releaseStream?.(); });

    confirmSpy.mockRestore();
  });

  // ─── Knowledge Base Jobs ────────────────────────────────────────────────────

  function makeKbWorkspace() {
    return {
      workspace_id: "ws-kb",
      name: "Workspace KB",
      system_message: "KB system message",
      selected_model: {
        model_id: "gpt-5.4-nano",
        label: "gpt-5.4-nano",
        is_enabled: true,
        is_default_workspace_model: true,
      },
      model_settings: { temperature: 0.7 },
      created_at: "2026-05-19T00:00:00Z",
      updated_at: "2026-05-19T00:00:00Z",
    };
  }

  async function openKnowledgeBaseManagement(
    user: ReturnType<typeof userEvent.setup>,
    knowledgeBaseSettingsOverride?: Partial<{
      workspace_id: string;
      chunk_size: number;
      chunk_overlap: number;
      retrieval_top_k: number;
      similarity_threshold: number;
      knowledge_answering_default: boolean;
      rebuild_required: boolean;
    }>,
  ) {
    mockedListWorkspaces.mockResolvedValue([makeKbWorkspace()]);
    mockedListWorkspaceConversations.mockResolvedValue([]);
    mockedGetKnowledgeBaseSettings.mockResolvedValue({
      workspace_id: "ws-kb",
      chunk_size: 800,
      chunk_overlap: 200,
      retrieval_top_k: 8,
      similarity_threshold: 0.2,
      knowledge_answering_default: false,
      rebuild_required: false,
      ...knowledgeBaseSettingsOverride,
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open workspace settings" }));
    await user.click(await screen.findByRole("tab", { name: "Knowledge Base" }));
    await user.click(await screen.findByRole("button", { name: "Open Knowledge Base Management" }));
    expect(await screen.findByRole("heading", { name: "Knowledge Base Management" })).toBeInTheDocument();
  }

  it("shows rebuild required prompt in management and lets the user start a rebuild", async () => {
    const user = userEvent.setup();

    mockedCreateRebuildJob.mockResolvedValue({
      job_id: "job-rebuild",
      workspace_id: "ws-kb",
      job_type: "rebuild",
      status: "queued",
      file_count: 1,
      created_at: "2026-05-19T02:00:00Z",
      completed_at: null,
    });
    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [
        {
          job_id: "job-rebuild",
          workspace_id: "ws-kb",
          job_type: "rebuild",
          status: "queued" as const,
          file_count: 1,
          created_at: "2026-05-19T02:00:00Z",
          completed_at: null,
        },
      ],
      history: [],
      history_total: 0,
      history_page: 1,
    });

    await openKnowledgeBaseManagement(user, {
      chunk_size: 1000,
      rebuild_required: true,
    });

    expect(await screen.findByText("Rebuild Required")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rebuild Knowledge Base" }));

    expect(mockedCreateRebuildJob).toHaveBeenCalledWith("ws-kb");
    expect(await screen.findByText(/knowledge base rebuild - queued/i)).toBeInTheDocument();
  });

  it("shows newly created import job as active after uploading files", async () => {
    const user = userEvent.setup();

    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [],
      history: [],
      history_total: 0,
      history_page: 1,
    });

    const newJob = {
      job_id: "job-1",
      workspace_id: "ws-kb",
      status: "queued" as const,
      file_count: 2,
      created_at: "2026-05-19T01:00:00Z",
      completed_at: null,
    };
    mockedCreateImportJob.mockResolvedValue(newJob);
    mockedListKnowledgeBaseJobs.mockResolvedValueOnce({
      active: [],
      history: [],
      history_total: 0,
      history_page: 1,
    });
    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [newJob],
      history: [],
      history_total: 0,
      history_page: 1,
    });

    await openKnowledgeBaseManagement(user);

    const fileInput = screen.getByLabelText("Select files to import");
    const files = [
      new File(["content a"], "doc_a.txt", { type: "text/plain" }),
      new File(["content b"], "doc_b.txt", { type: "text/plain" }),
    ];
    await user.upload(fileInput, files);

    await user.click(screen.getByRole("button", { name: "Import files" }));

    expect(await screen.findByText(/2 files/i)).toBeInTheDocument();
    expect(await screen.findByText(/queued/i)).toBeInTheDocument();
  });

  it("polls knowledge base management while the screen stays open", async () => {
    const user = userEvent.setup();

    const queuedJob = {
      job_id: "job-1",
      workspace_id: "ws-kb",
      status: "queued" as const,
      file_count: 1,
      created_at: "2026-05-19T01:00:00Z",
      completed_at: null,
    };

    mockedCreateImportJob.mockResolvedValue(queuedJob);
    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [queuedJob],
      history: [],
      history_total: 0,
      history_page: 1,
    });
    mockedListKnowledgeBaseDocuments.mockResolvedValue({ documents: [] });

    await openKnowledgeBaseManagement(user);

    const fileInput = screen.getByLabelText("Select files to import");
    await user.upload(fileInput, [new File(["content"], "guide.txt", { type: "text/plain" })]);
    await user.click(screen.getByRole("button", { name: "Import files" }));

    expect(await screen.findByText(/queued/i)).toBeInTheDocument();
    const jobsCallsBeforePolling = mockedListKnowledgeBaseJobs.mock.calls.length;
    const documentCallsBeforePolling = mockedListKnowledgeBaseDocuments.mock.calls.length;

    await waitFor(
      () => expect(mockedListKnowledgeBaseJobs.mock.calls.length).toBeGreaterThan(jobsCallsBeforePolling),
      { timeout: 4000 },
    );
    expect(mockedListKnowledgeBaseDocuments.mock.calls.length).toBeGreaterThan(documentCallsBeforePolling);
  }, 10000);

  it("shows running job status without a cancel button", async () => {
    const user = userEvent.setup();

    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [
        {
          job_id: "job-running",
          workspace_id: "ws-kb",
          status: "running" as const,
          file_count: 1,
          created_at: "2026-05-19T01:00:00Z",
          completed_at: null,
        },
      ],
      history: [],
      history_total: 0,
      history_page: 1,
    });

    await openKnowledgeBaseManagement(user);

    expect(await screen.findByText(/running/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("shows cancel button for queued job and removes it after cancel", async () => {
    const user = userEvent.setup();

    const queuedJob = {
      job_id: "job-queued",
      workspace_id: "ws-kb",
      status: "queued" as const,
      file_count: 3,
      created_at: "2026-05-19T01:00:00Z",
      completed_at: null,
    };
    mockedListKnowledgeBaseJobs.mockResolvedValueOnce({
      active: [queuedJob],
      history: [],
      history_total: 0,
      history_page: 1,
    });
    mockedCancelImportJob.mockResolvedValue({ ...queuedJob, status: "canceled" });
    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [],
      history: [{ ...queuedJob, status: "canceled" as const }],
      history_total: 1,
      history_page: 1,
    });

    await openKnowledgeBaseManagement(user);

    const cancelButton = await screen.findByRole("button", { name: /cancel job/i });
    expect(cancelButton).toBeInTheDocument();

    await user.click(cancelButton);

    expect(mockedCancelImportJob).toHaveBeenCalledWith("ws-kb", "job-queued");
    await waitFor(() => expect(screen.queryByRole("button", { name: /cancel job/i })).not.toBeInTheDocument());
  });

  it("shows completed jobs in history section below active jobs", async () => {
    const user = userEvent.setup();

    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [
        {
          job_id: "job-active",
          workspace_id: "ws-kb",
          status: "running" as const,
          file_count: 1,
          created_at: "2026-05-19T02:00:00Z",
          completed_at: null,
        },
      ],
      history: [
        {
          job_id: "job-done",
          workspace_id: "ws-kb",
          status: "completed" as const,
          file_count: 2,
          created_at: "2026-05-19T01:00:00Z",
          completed_at: "2026-05-19T01:30:00Z",
        },
      ],
      history_total: 1,
      history_page: 1,
    });

    await openKnowledgeBaseManagement(user);

    expect(await screen.findByText(/running/i)).toBeInTheDocument();
    expect(await screen.findByText(/completed/i)).toBeInTheDocument();

    const activeSection = screen.getByRole("region", { name: /active jobs/i });
    const historySection = screen.getByRole("region", { name: /job history/i });

    // Active section should appear before history section in DOM order.
    expect(
      activeSection.compareDocumentPosition(historySection) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows imported knowledge documents with chunk count and locator metadata", async () => {
    const user = userEvent.setup();

    mockedListKnowledgeBaseDocuments.mockResolvedValue({
      documents: [
        {
          knowledge_document_id: "doc-1",
          display_filename: "guide.txt",
          revision_number: 2,
          chunk_count: 3,
          locator_summary: ["Page 1"],
          created_at: "2026-05-19T01:00:00Z",
          updated_at: "2026-05-19T02:00:00Z",
        },
      ],
    });

    await openKnowledgeBaseManagement(user);

    expect(await screen.findByText("guide.txt")).toBeInTheDocument();
    expect(screen.getByText(/revision 2/i)).toBeInTheDocument();
    expect(screen.getByText(/3 chunks/i)).toBeInTheDocument();
    expect(screen.getByText(/page 1/i)).toBeInTheDocument();
  });

  it("shows per-file outcomes and lets the user delete a knowledge document", async () => {
    const user = userEvent.setup();

    const existingDocument = {
      knowledge_document_id: "doc-1",
      display_filename: "guide.txt",
      revision_number: 1,
      chunk_count: 1,
      locator_summary: ["Page 1"],
      created_at: "2026-05-19T01:00:00Z",
      updated_at: "2026-05-19T01:00:00Z",
    };

    mockedListKnowledgeBaseDocuments.mockResolvedValueOnce({
      documents: [existingDocument],
    });
    mockedListKnowledgeBaseJobs.mockResolvedValueOnce({
      active: [],
      history: [
        {
          job_id: "job-history",
          workspace_id: "ws-kb",
          status: "failed" as const,
          file_count: 2,
          created_at: "2026-05-19T03:00:00Z",
          completed_at: "2026-05-19T03:01:00Z",
          items: [
            {
              item_id: "item-1",
              filename: "guide.txt",
              status: "imported",
              outcome: "imported",
              error_message: null,
            },
            {
              item_id: "item-2",
              filename: "slides.pdf",
              status: "unsupported",
              outcome: "unsupported",
              error_message: "Unsupported file type: .pdf",
            },
          ],
        },
      ],
      history_total: 1,
      history_page: 1,
    });
    mockedDeleteKnowledgeBaseDocument.mockResolvedValue(undefined);
    mockedListKnowledgeBaseDocuments.mockResolvedValue({
      documents: [],
    });
    mockedListKnowledgeBaseJobs.mockResolvedValue({
      active: [],
      history: [],
      history_total: 0,
      history_page: 1,
    });

    await openKnowledgeBaseManagement(user);

    expect(await screen.findByText(/slides\.pdf/i)).toBeInTheDocument();
    expect(screen.getAllByText(/unsupported/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Delete guide.txt" }));

    expect(mockedDeleteKnowledgeBaseDocument).toHaveBeenCalledWith("ws-kb", "doc-1");
    await waitFor(() => expect(screen.queryByText("guide.txt")).not.toBeInTheDocument());
  });
});

