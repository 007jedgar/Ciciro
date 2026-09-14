import type { NdjsonEvent } from "./types";

export class StallError extends Error {
  constructor(message = "Stream stalled") {
    super(message);
    this.name = "StallError";
  }
}

export type ReadNdjsonOptions = {
  signal?: AbortSignal;
  stallMs?: number;
  onEvent?: (evt: NdjsonEvent) => void;
};

/** Wrap a fully buffered body so callers can still use the stream reader. */
export function streamFromText(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength) controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function emitNdjsonText(
  text: string,
  onEvent?: (evt: NdjsonEvent) => void
): void {
  emitNdjsonChunk(text + "\n", onEvent);
}

export function emitNdjsonChunk(
  chunk: string,
  onEvent?: (evt: NdjsonEvent) => void
): string {
  const lines = chunk.split("\n");
  const rest = lines.pop() || "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload) continue;
    let evt: NdjsonEvent;
    try {
      evt = JSON.parse(payload) as NdjsonEvent;
    } catch {
      continue;
    }
    if (evt.type === "ping") continue;
    onEvent?.(evt);
  }
  return rest;
}

/**
 * Consume an NDJSON ReadableStream, invoking onEvent for each full line.
 * Pings reset the stall timer and are not forwarded.
 * React Native often delivers the whole POST /api/chat body at once (or with
 * no `response.body` stream); a trailing line without a newline still counts.
 */
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  opts: ReadNdjsonOptions = {}
): Promise<void> {
  const stallMs = opts.stallMs ?? 45_000;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastActivity = Date.now();

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  opts.signal?.addEventListener("abort", onAbort);

  try {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    while (true) {
      if (opts.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const wait = Math.max(1, stallMs - (Date.now() - lastActivity));
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const stallPromise = new Promise<never>((_, reject) => {
        stallTimer = setTimeout(() => reject(new StallError()), wait);
      });
      try {
        const { done, value } = await Promise.race([
          reader.read().then((result) => {
            if (stallTimer) clearTimeout(stallTimer);
            return result;
          }),
          stallPromise,
        ]);
        if (done) break;
        if (!value) continue;

        lastActivity = Date.now();
        buffer += decoder.decode(value, { stream: true });
        buffer = emitNdjsonChunk(buffer, opts.onEvent);
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
    }
    buffer += decoder.decode();
    emitNdjsonText(buffer, opts.onEvent);
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
  }
}
