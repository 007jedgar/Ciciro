import type { NdjsonEvent } from "./types";
import { emitNdjsonChunk, emitNdjsonText } from "./ndjson";

export function shouldUseXhrNdjson(): boolean {
  return typeof XMLHttpRequest !== "undefined" && process.env.JEST_WORKER_ID == null;
}

export type XhrNdjsonInit = {
  method?: string;
  headers: Headers;
  body?: string | null;
  signal?: AbortSignal | null;
  onEvent?: (evt: NdjsonEvent) => void;
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
 */
export function readNdjsonViaXhr(url: string, init: XhrNdjsonInit): Promise<XhrNdjsonResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? "POST", url);
    init.headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    let seen = 0;
    let buffer = "";
    const consume = () => {
      const chunk = xhr.responseText.slice(seen);
      seen = xhr.responseText.length;
      if (!chunk) return;
      buffer = emitNdjsonChunk(buffer + chunk, init.onEvent);
    };

    const onAbort = () => {
      xhr.abort();
    };
    init.signal?.addEventListener("abort", onAbort);

    xhr.onprogress = consume;
    xhr.onerror = () => {
      init.signal?.removeEventListener("abort", onAbort);
      reject(new TypeError("Network request failed"));
    };
    xhr.onabort = () => {
      init.signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    xhr.onload = () => {
      init.signal?.removeEventListener("abort", onAbort);
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
    xhr.send(init.body ?? null);
  });
}
