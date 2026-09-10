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

/**
 * Consume an NDJSON ReadableStream, invoking onEvent for each full line.
 * Pings reset the stall timer and are not forwarded.
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
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: NdjsonEvent;
          try {
            evt = JSON.parse(line) as NdjsonEvent;
          } catch {
            continue;
          }
          if (evt.type === "ping") {
            lastActivity = Date.now();
            continue;
          }
          opts.onEvent?.(evt);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
  }
}
