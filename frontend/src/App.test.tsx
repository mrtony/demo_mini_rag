import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import {
  createWorkspace,
  getDefaultWorkspaceModel,
  getConversation,
  listModels,
  listWorkspaceConversations,
  listWorkspaces,
  openChatStream,
  stopConversation,
  updateWorkspace,
} from "./api";
import { readSseStream } from "./lib/sse";

vi.mock("./api", () => ({
  createWorkspace: vi.fn(),
  getDefaultWorkspaceModel: vi.fn(),
  getConversation: vi.fn(),
  listModels: vi.fn(),
  listWorkspaceConversations: vi.fn(),
  listWorkspaces: vi.fn(),
  openChatStream: vi.fn(),
  stopConversation: vi.fn(),
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

const mockedCreateWorkspace = vi.mocked(createWorkspace);
const mockedGetDefaultWorkspaceModel = vi.mocked(getDefaultWorkspaceModel);
const mockedGetConversation = vi.mocked(getConversation);
const mockedListModels = vi.mocked(listModels);
const mockedListWorkspaceConversations = vi.mocked(listWorkspaceConversations);
const mockedListWorkspaces = vi.mocked(listWorkspaces);
const mockedOpenChatStream = vi.mocked(openChatStream);
const mockedStopConversation = vi.mocked(stopConversation);
const mockedUpdateWorkspace = vi.mocked(updateWorkspace);
const mockedReadSseStream = vi.mocked(readSseStream);

describe("App", () => {
  beforeEach(() => {
    mockedCreateWorkspace.mockReset();
    mockedGetDefaultWorkspaceModel.mockReset();
    mockedGetConversation.mockReset();
    mockedListModels.mockReset();
    mockedListWorkspaceConversations.mockReset();
    mockedListWorkspaces.mockReset();
    mockedOpenChatStream.mockReset();
    mockedStopConversation.mockReset();
    mockedUpdateWorkspace.mockReset();
    mockedReadSseStream.mockReset();
    mockedStopConversation.mockResolvedValue(undefined);
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

    expect(await screen.findByRole("button", { name: /Workspace Alpha/ })).toBeInTheDocument();
    expect(await screen.findByText("Alpha convo")).toBeInTheDocument();
    expect(mockedListWorkspaceConversations).toHaveBeenCalledWith("ws-alpha");

    await user.click(screen.getByRole("button", { name: /Workspace Beta/ }));

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

    expect(await screen.findByRole("button", { name: /New Workspace/ })).toBeInTheDocument();

    await user.type(screen.getByLabelText("訊息輸入框"), "第一句話");
    await user.click(screen.getByLabelText("Send message"));

    expect(mockedOpenChatStream).toHaveBeenCalledWith(
      {
        workspace_id: "ws-new",
        conversation_id: 0,
        message_id: 0,
        message: "第一句話",
      },
      expect.any(AbortSignal),
    );
    expect(mockedGetDefaultWorkspaceModel).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /第一句話/ })).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: /Workspace One/ })).toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: /較早的對話/ }));

    expect(await screen.findByText("舊問題")).toBeInTheDocument();
    expect(await screen.findByText("舊回答")).toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: /Workspace Alpha/ })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Workspace Renamed/ })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /Workspace Beta/ }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Workspace Settings" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Workspace Draft")).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: /Workspace Beta/ }));

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
});
