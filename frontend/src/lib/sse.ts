import type { ParsedSseEvent } from "../types";

function parseBlock(block: string): ParsedSseEvent | null {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
  };
}

export function parseSseChunks(buffer: string): { events: ParsedSseEvent[]; remainder: string } {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";
  const events = parts
    .map((part) => parseBlock(part))
    .filter((item): item is ParsedSseEvent => item !== null);

  return { events, remainder };
}

export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ParsedSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abortPromise =
    signal === undefined
      ? null
      : new Promise<never>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true },
          );
        });

  try {
    while (true) {
      const nextChunk = reader.read();
      const result = abortPromise === null ? await nextChunk : await Promise.race([nextChunk, abortPromise]);
      const { done, value } = result as ReadableStreamReadResult<Uint8Array>;
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunks(buffer);
      buffer = parsed.remainder;
      parsed.events.forEach(onEvent);
    }

    buffer += decoder.decode();
    const parsed = parseSseChunks(`${buffer}\n\n`);
    parsed.events.forEach(onEvent);
  } finally {
    reader.releaseLock();
  }
}
