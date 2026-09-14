import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  normalizeEmail,
  validatePassword,
} from "@/lib/auth/tokens";
import {
  MIN_PASSWORD_LENGTH,
  NATIVE_CLIENT_HEADER,
  NATIVE_CLIENT_VALUE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  isNativeClient,
  sessionResponseBody,
  tokenFromCookieHeader,
  hasRequestSession,
  requestWithSessionHeaders,
} from "@/lib/auth/constants";

describe("session tokens", () => {
  it("generates unique, url-safe tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes a token deterministically and irreversibly", () => {
    const token = generateSessionToken();
    const h1 = hashSessionToken(token);
    const h2 = hashSessionToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
    expect(h1).not.toBe(token);
  });

  it("uses a stable cookie name and a positive TTL", () => {
    expect(SESSION_COOKIE).toBe("ciciro_session");
    expect(SESSION_TTL_MS).toBeGreaterThan(0);
  });
});

describe("native session delivery", () => {
  it("only attaches a token for native clients", () => {
    const native = new Headers({ [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE });
    const browser = new Headers();
    expect(isNativeClient({ headers: native })).toBe(true);
    expect(isNativeClient({ headers: browser })).toBe(false);

    const body = { user: { id: "u1" } };
    expect(sessionResponseBody(body, "tok", false)).toEqual(body);
    expect(sessionResponseBody(body, "tok", true)).toEqual({ ...body, token: "tok" });
    expect(sessionResponseBody(body, "", true)).toEqual(body);
  });

  it("reads the session token from a Cookie header", () => {
    expect(tokenFromCookieHeader("ciciro_session=abc123; Path=/")).toBe("abc123");
    expect(tokenFromCookieHeader("other=1; ciciro_session=tok%2F2")).toBe("tok/2");
    expect(tokenFromCookieHeader("nope=1")).toBeNull();
    expect(tokenFromCookieHeader(null)).toBeNull();
  });

  it("treats the native session header as a signed-in request", () => {
    const headers = new Headers({ "x-ciciro-session": "tok-123" });
    expect(hasRequestSession(headers)).toBe(true);
    expect(hasRequestSession(new Headers(), "tok-123")).toBe(true);
    expect(hasRequestSession(new Headers({ cookie: "ciciro_session=tok" }))).toBe(true);
    expect(hasRequestSession(new Headers())).toBe(false);
  });

  it("copies the native session header onto Cookie for OpenNext", () => {
    const request = requestWithSessionHeaders(
      new Request("https://ciciro.app/api/projects/p1", {
        headers: { "x-ciciro-session": "tok-123" },
      })
    );
    expect(request.headers.get("x-ciciro-session")).toBe("tok-123");
    expect(request.headers.get("cookie")).toBe("ciciro_session=tok-123");

    const alreadyCookied = requestWithSessionHeaders(
      new Request("https://ciciro.app/api/chapters?projectId=p1", {
        headers: { cookie: "theme=dark; ciciro_session=tok-123" },
      })
    );
    expect(alreadyCookied.headers.get("x-ciciro-session")).toBe("tok-123");
    expect(alreadyCookied.headers.get("cookie")).toBe("theme=dark; ciciro_session=tok-123");
  });
});

describe("email normalization", () => {
  it("lowercases and trims valid emails", () => {
    expect(normalizeEmail("  Author@Example.COM ")).toBe("author@example.com");
  });

  it("rejects malformed or non-string emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("no@domain")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("password policy", () => {
  it("accepts a sufficiently long password", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("rejects short, over-long, and non-string passwords", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/);
    expect(validatePassword("a".repeat(513))).toMatch(/too long/);
    expect(validatePassword(undefined)).toMatch(/required/);
  });
});
