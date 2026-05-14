import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { getConversation, listConversations, openChatStream, stopConversation } from "./api";
import { readSseStream } from "./lib/sse";

vi.mock("./api", () => ({
  getConversation: vi.fn(),
  listConversations: vi.fn(),
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

const mockedListConversations = vi.mocked(listConversations);
const mockedGetConversation = vi.mocked(getConversation);
const mockedOpenChatStream = vi.mocked(openChatStream);
const mockedStopConversation = vi.mocked(stopConversation);
const mockedReadSseStream = vi.mocked(readSseStream);

describe("App", () => {
  beforeEach(() => {
    mockedListConversations.mockResolvedValue([]);
    mockedGetConversation.mockReset();
    mockedOpenChatStream.mockReset();
    mockedStopConversation.mockReset();
    mockedStopConversation.mockResolvedValue(undefined);
    mockedReadSseStream.mockReset();
  });

  it("hides the send button when the input is empty", async () => {
    render(<App />);

    await waitFor(() => expect(mockedListConversations).toHaveBeenCalled());
    expect(screen.queryByLabelText("Send message")).not.toBeInTheDocument();
  });

  it("keeps a stopped bubble stopped even if a final delta arrives after abort", async () => {
    const user = userEvent.setup();

    mockedOpenChatStream.mockResolvedValue({ body: {} as ReadableStream<Uint8Array> } as Response);
    mockedReadSseStream.mockImplementation(async (_body, onEvent, signal) => {
      onEvent({ event: "conversation.created", data: { conversation_id: "conv-1", conversation_title: "停止測試" } });
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

    mockedListConversations.mockResolvedValue([
      {
        conversation_id: "conv-older",
        conversation_title: "較早的對話",
        updated_at: "2026-05-09T12:00:00Z",
      },
    ]);
    mockedGetConversation.mockResolvedValue({
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
