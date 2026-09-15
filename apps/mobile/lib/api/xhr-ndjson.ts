import type { NdjsonEvent } from "./types";
import { emitNdjsonChunk, emitNdjsonText, StallError } from "./ndjson";

export function shouldUseXhrNdjson(): boolean {
  return typeof XMLHttpRequest !== "undefined" && process.env.JEST_WORKER_ID == null;
}

/** Matches the fetch reader's patience in `readNdjson`. */
const DEFAULT_STALL_MS = 45_000;

export type XhrNdjsonInit = {
  method?: string;
  headers: Headers;
  body?: string | null;
  signal?: AbortSignal | null;
  onEvent?: (evt: NdjsonEvent) => void;
  /** Silence this long ends the request. 0 or Infinity waits forever. */
  stallMs?: number;
};

export type XhrNdjsonResult = {
  status: number;
  header: (name: string) => string | null;
  body: string;
};

/**
 * React Native's WHATWG fetch often finishes a 200 NDJSON chat stream with
 * `body` null and an empty `text()`. XHR `responseText` grows as chunks
 * arrive, which is the same bytes a proxy inspector shows.
 *
 * XHR will also wait forever on a run that stops sending without closing the
 * connection, which leaves the caller — and the composer behind it — stuck
 * with no way out. A watchdog restarted by every chunk tears the request down
 * instead, so the turn fails like any other timeout.
 */
export function readNdjsonViaXhr(url: string, init: XhrNdjsonInit): Promise<XhrNdjsonResult> {
  const stallMs = init.stallMs ?? DEFAULT_STALL_MS;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "POST", url);
    init.headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    let seen = 0;
    let buffer = "";
    let settled = false;
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => {
      xhr.abort();
    };

    /** Claims the single settlement, and stands everything else down. */
    const claim = () => {
      if (settled) return false;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      init.signal?.removeEventListener("abort", onAbort);
      return true;
    };

    const arm = () => {
      if (settled) return;
      if (stallTimer) clearTimeout(stallTimer);
      if (!Number.isFinite(stallMs) || stallMs <= 0) return;
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, stallMs);
    };

    const consume = () => {
      const chunk = xhr.responseText.slice(seen);
      seen = xhr.responseText.length;
      if (!chunk) return;
      buffer = emitNdjsonChunk(buffer + chunk, init.onEvent);
    };

    init.signal?.addEventListener("abort", onAbort);

    xhr.onprogress = () => {
      arm();
      consume();
    };
    xhr.onerror = () => {
      if (claim()) reject(new TypeError("Network request failed"));
    };
    xhr.onabort = () => {
      if (!claim()) return;
      reject(stalled ? new StallError() : new DOMException("Aborted", "AbortError"));
    };
    xhr.ontimeout = () => {
      if (claim()) reject(new StallError());
    };
    xhr.onload = () => {
      if (!claim()) return;
      consume();
      emitNdjsonText(buffer, init.onEvent);
      resolve({
        status: xhr.status,
        header: (name) => xhr.getResponseHeader(name),
        body: xhr.responseText,
      });
    };

    if (init.signal?.aborted) {
      onAbort();
      return;
    }
    arm();
    xhr.send(init.body ?? null);
  });
}
