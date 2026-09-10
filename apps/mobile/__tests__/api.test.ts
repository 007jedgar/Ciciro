import { api, apiBlob, apiStream, ApiError, isApiError } from "../lib/api";
import { getSessionToken, resetSessionMemory, setSessionToken } from "../lib/session-store";
import { jsonResponse, lastFetchCall, mockFetch, textResponse } from "./http";

describe("api client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setSessionToken(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends JSON, attaches the session cookie, and returns the parsed body", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ id: "p1", title: "The Book" }));
    setSessionToken("tok-123");

    const result = await api<{ id: string; title: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title: "The Book" }),
    });

    expect(result).toEqual({ id: "p1", title: "The Book" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/projects$/),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("cookie")).toBe("ciciro_session=tok-123");
    expect(headers.get("x-ciciro-client")).toBe("native");
  });

  it("re-attaches a persisted cookie after in-memory auth is wiped", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ ok: true }));
    setSessionToken("tok-123");
    resetSessionMemory();

    await api("/api/auth/me");

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("cookie")).toBe("ciciro_session=tok-123");
  });

  it("captures a session token from Set-Cookie", async () => {
    mockFetch(async () =>
      jsonResponse(
        { user: { id: "u1", email: "ada@example.com", name: "Ada" } },
        { setCookie: "ciciro_session=fresh-token; Path=/; HttpOnly" }
      )
    );

    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ada@example.com", password: "secret-pw" }),
    });

    expect(getSessionToken()).toBe("fresh-token");
  });

  it("captures a session token from the native session header", async () => {
    mockFetch(async () =>
      jsonResponse(
        { user: { id: "u1", email: "ada@example.com", name: "Ada" } },
        { sessionHeader: "header-token" }
      )
    );

    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ada@example.com", password: "secret-pw" }),
    });

    expect(getSessionToken()).toBe("header-token");
  });

  it("captures a session token from the login JSON body", async () => {
    mockFetch(async () =>
      jsonResponse({
        user: { id: "u1", email: "ada@example.com", name: "Ada" },
        token: "json-token",
      })
    );

    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ada@example.com", password: "secret-pw" }),
    });

    expect(getSessionToken()).toBe("json-token");
  });

  it("throws ApiError with the server message and body", async () => {
    mockFetch(async () =>
      jsonResponse({ error: "You do not have access to this manuscript." }, { status: 403 })
    );

    await expect(api("/api/projects/other")).rejects.toEqual(
      expect.objectContaining({
        message: "You do not have access to this manuscript.",
        status: 403,
        body: { error: "You do not have access to this manuscript." },
      })
    );
    await expect(api("/api/projects/other")).rejects.toBeInstanceOf(ApiError);
    expect(isApiError(new ApiError("nope", 401))).toBe(true);
    expect(isApiError(new Error("nope"))).toBe(false);
  });

  it("preserves a chapter revision conflict body", async () => {
    const body = {
      error: "Chapter revision conflict",
      expectedRevision: 3,
      currentRevision: 4,
      chapter: { id: "c1", revision: 4 },
    };
    mockFetch(async () => jsonResponse(body, { status: 409 }));

    await expect(api("/api/chapters/c1")).rejects.toMatchObject({
      status: 409,
      body,
    });
  });

  it("uses a fallback message for empty or non-JSON error bodies", async () => {
    mockFetch(async () => new Response("", { status: 500 }));
    await expect(api("/api/health")).rejects.toMatchObject({
      message: "Request failed (500)",
      status: 500,
    });

    mockFetch(async () => textResponse("nope", 502));
    await expect(api("/api/health")).rejects.toMatchObject({
      message: "nope",
      status: 502,
    });
  });

  it("returns an empty object for an empty 200 body", async () => {
    mockFetch(async () => new Response("", { status: 200 }));
    await expect(api("/api/health")).resolves.toEqual({});
  });

  it("does not overwrite an explicit Cookie header", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    setSessionToken("tok-123");
    await api("/api/auth/me", { headers: { cookie: "ciciro_session=other" } });
    const headers = new Headers(lastFetchCall().init.headers);
    expect(headers.get("cookie")).toBe("ciciro_session=other");
  });

  it("downloads export bytes and reads the filename", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4]);
    mockFetch(
      async () =>
        new Response(bytes, {
          headers: {
            "content-type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content-disposition": 'attachment; filename="night_watch.docx"',
          },
        })
    );

    const file = await apiBlob("/api/export/p1");
    expect(file.filename).toBe("night_watch.docx");
    expect(file.contentType).toContain("wordprocessingml");
    expect(new Uint8Array(file.bytes)).toEqual(bytes);
    expect(lastFetchCall().url).toMatch(/\/api\/export\/p1$/);
  });

  it("falls back to download when Content-Disposition is missing", async () => {
    mockFetch(async () => new Response(new Uint8Array([1, 2]), { status: 200 }));
    await expect(apiBlob("/api/export/p1")).resolves.toMatchObject({ filename: "download" });
  });

  it("throws ApiError for failed blob and stream responses", async () => {
    mockFetch(async () => jsonResponse({ error: "Not found" }, { status: 404 }));
    await expect(apiBlob("/api/export/missing")).rejects.toMatchObject({ status: 404 });

    mockFetch(async () =>
      jsonResponse({ error: "Editor run is already executing" }, { status: 409 })
    );
    await expect(apiStream("/api/chat", { method: "POST" })).rejects.toMatchObject({
      status: 409,
      message: "Editor run is already executing",
    });
  });

  it("returns the response body stream when the request succeeds", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}\n"));
        controller.close();
      },
    });
    mockFetch(async () => new Response(stream, { status: 200 }));
    const body = await apiStream("/api/chat", { method: "POST", body: "{}" });
    expect(typeof body.getReader).toBe("function");
  });
});
