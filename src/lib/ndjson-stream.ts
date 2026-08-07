// Robust NDJSON stream reader for chat/autowrite. Detects stalls (no bytes for
// a while) so the client can reconnect instead of hanging forever on a dead
// TCP half-open connection.

export type NdjsonEvent = { type: string; v?: string; id?: string; [k: string]: unknown };

export type ReadNdjsonOptions = {
  /** Abort the underlying reader. */
  signal?: AbortSignal;
  /** No chunks for this long → throw StallError (default 45s). */
  stallMs?: number;
  onEvent?: (evt: NdjsonEvent) => void;
  /** Called on each byte chunk (resets stall timer). */
  onActivity?: () => void;
};

export class StallError extends Error {
  constructor(message = "Stream stalled") {
    super(message);
    this.name = "StallError";
  }
}

export class OfflineError extends Error {
  constructor(message = "Offline") {
    super(message);
    this.name = "OfflineError";
  }
}

/**
 * Consume an NDJSON ReadableStream, invoking onEvent for each full line.
 * Throws StallError if no data arrives within stallMs; OfflineError if the
 * browser reports offline mid-read.
 */
export async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  opts: ReadNdjsonOptions = {}
): Promise<void> {
  const stallMs = opts.stallMs ?? 45_000;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastActivity = Date.now();
  let stallTimer: ReturnType<typeof setInterval> | null = null;

  const onAbort = () => {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  };
  opts.signal?.addEventListener("abort", onAbort);

  stallTimer = setInterval(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      reader.cancel().catch(() => {});
      return;
    }
    if (Date.now() - lastActivity > stallMs) {
      reader.cancel().catch(() => {});
    }
  }, 2_000);

  try {
    while (true) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new OfflineError();
      }

      const readPromise = reader.read();
      const stallPromise = new Promise<never>((_, reject) => {
        const wait = Math.max(500, stallMs - (Date.now() - lastActivity));
        const t = setTimeout(() => reject(new StallError()), wait);
        readPromise.finally(() => clearTimeout(t));
      });

      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([readPromise, stallPromise]);
      } catch (err) {
        if (err instanceof StallError) throw err;
        throw err;
      }

      const { done, value } = result;
      if (done) break;
      if (!value) continue;

      lastActivity = Date.now();
      opts.onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: NdjsonEvent;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === "ping") {
          lastActivity = Date.now();
          opts.onActivity?.();
          continue;
        }
        opts.onEvent?.(evt);
      }
    }
  } finally {
    if (stallTimer) clearInterval(stallTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

/** Wait until the browser reports online, or the signal aborts. */
export function waitForOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onOnline = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      window.removeEventListener("online", onOnline);
      signal?.removeEventListener("abort", onAbort);
    };
    window.addEventListener("online", onOnline);
    signal?.addEventListener("abort", onAbort);
  });
}

/** Poll chat history until an assistant message for turnId appears (or timeout). */
export async function pollForTurnAssistant(
  projectId: string,
  turnId: string,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}
): Promise<{ id: string; content: string; status: string } | null> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const intervalMs = opts.intervalMs ?? 1_200;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const r = await fetch(`/api/chat?projectId=${projectId}`);
      const data = await r.json();
      if (Array.isArray(data)) {
        const assistant = [...data]
          .reverse()
          .find(
            (m: { role: string; turnId?: string | null }) =>
              m.role === "assistant" && m.turnId === turnId
          );
        if (assistant) {
          return {
            id: assistant.id,
            content: assistant.content,
            status: assistant.status || "complete",
          };
        }
      }
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
