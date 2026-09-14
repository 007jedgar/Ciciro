export function jsonResponse(
  body: unknown,
  init: { status?: number; setCookie?: string; sessionHeader?: string } = {}
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.setCookie) headers.set("set-cookie", init.setCookie);
  if (init.sessionHeader) headers.set("x-ciciro-session", init.sessionHeader);
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

export function ndjsonResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

/** Mimic React Native fetch: 200 NDJSON with no WHATWG `body` stream. */
export function bufferedNdjsonResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/x-ndjson; charset=utf-8" }),
    body: null,
    text: async () => body,
  } as unknown as Response;
}

export function blobResponse(
  bytes: Uint8Array,
  init: { filename?: string; contentType?: string; status?: number } = {}
): Response {
  const headers = new Headers({
    "content-type": init.contentType ?? "application/octet-stream",
  });
  if (init.filename) {
    headers.set("content-disposition", `attachment; filename="${init.filename}"`);
  }
  return new Response(bytes, { status: init.status ?? 200, headers });
}

export function mockFetch(handler: typeof fetch): jest.Mock {
  const fetchMock = jest.fn(handler);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

export function lastFetchCall(): { url: string; init: RequestInit } {
  const fetchMock = globalThis.fetch as unknown as jest.Mock;
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url, init };
}

export function parsedBody(init?: RequestInit): unknown {
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}
