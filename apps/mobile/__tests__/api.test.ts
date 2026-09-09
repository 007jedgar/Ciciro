import { api, ApiError } from "../lib/api";
import { getSessionToken, setSessionToken } from "../lib/session-store";

function jsonResponse(body: unknown, init: { status?: number; setCookie?: string } = {}): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.setCookie) headers.set("set-cookie", init.setCookie);
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

describe("api client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setSessionToken(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends JSON, attaches the session cookie, and returns the parsed body", async () => {
    const fetchMock = jest.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({ id: "p1", title: "The Book" })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    setSessionToken("tok-123");
    const result = await api<{ id: string; title: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title: "The Book" }),
    });

    expect(result).toEqual({ id: "p1", title: "The Book" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
  });

  it("captures a session token from Set-Cookie", async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(
        { user: { id: "u1", email: "ada@example.com", name: "Ada" } },
        { setCookie: "ciciro_session=fresh-token; Path=/; HttpOnly" }
      )
    ) as unknown as typeof fetch;

    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ada@example.com", password: "secret-pw" }),
    });

    expect(getSessionToken()).toBe("fresh-token");
  });

  it("throws ApiError with the server message", async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse({ error: "You do not have access to this manuscript." }, { status: 403 })
    ) as unknown as typeof fetch;

    await expect(api("/api/projects/other")).rejects.toEqual(
      expect.objectContaining({
        message: "You do not have access to this manuscript.",
        status: 403,
      })
    );
    await expect(api("/api/projects/other")).rejects.toBeInstanceOf(ApiError);
  });
});
