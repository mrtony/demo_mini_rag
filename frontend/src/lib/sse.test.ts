import { parseSseChunks } from "./sse";

describe("parseSseChunks", () => {
  it("parses complete events and preserves remainder", () => {
    const parsed = parseSseChunks(
      'event: message.delta\ndata: {"delta":"Hi"}\n\n:event\nevent: message.done\ndata: {"status":"completed"}',
    );

    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toEqual({
      event: "message.delta",
      data: { delta: "Hi" },
    });
    expect(parsed.remainder).toContain("message.done");
  });
});
