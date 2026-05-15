import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import {
  createWorkspace,
  getConversation,
  listWorkspaceConversations,
  listWorkspaces,
  openChatStream,
  stopConversation,
} from "./api";
import { readSseStream } from "./lib/sse";

vi.mock("./api", () => ({
  createWorkspace: vi.fn(),
  getConversation: vi.fn(),
  listWorkspaceConversations: vi.fn(),
  listWorkspaces: vi.fn(),
  openChatStream: vi.fn(),
  stopConversation: vi.fn(),
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
const mockedGetConversation = vi.mocked(getConversation);
const mockedListWorkspaceConversations = vi.mocked(listWorkspaceConversations);
const mockedListWorkspaces = vi.mocked(listWorkspaces);
const mockedOpenChatStream = vi.mocked(openChatStream);
const mockedStopConversation = vi.mocked(stopConversation);
const mockedReadSseStream = vi.mocked(readSseStream);

describe("App", () => {
  beforeEach(() => {
    mockedCreateWorkspace.mockReset();
    mockedGetConversation.mockReset();
    mockedListWorkspaceConversations.mockReset();
    mockedListWorkspaces.mockReset();
    mockedOpenChatStream.mockReset();
    mockedStopConversation.mockReset();
    mockedReadSseStream.mockReset();
    mockedStopConversation.mockResolvedValue(undefined);
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
});
