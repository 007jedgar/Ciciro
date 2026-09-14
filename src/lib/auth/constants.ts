// Pure auth constants with no runtime dependencies. Safe to import from the
// Edge middleware (which cannot bundle node:crypto). Crypto-backed helpers live
// in tokens.ts / session.ts (Node runtime only).

// The session cookie name. httpOnly so client JS cannot read it.
export const SESSION_COOKIE = "ciciro_session";

// Native clients send this so login/signup/me can return a JS-readable token.
// React Native fetch does not expose Set-Cookie, and Metro reloads drop any
// in-memory cookie jar.
export const NATIVE_CLIENT_HEADER = "x-ciciro-client";
export const NATIVE_CLIENT_VALUE = "native";
export const SESSION_HEADER = "x-ciciro-session";

/** Hosted deployments set this so anonymous traffic cannot list every manuscript. */
export function authRequired(): boolean {
  return process.env["CICIRO_REQUIRE_AUTH"] === "true";
}

/** Pull the session token out of a raw Cookie header (React Native / OpenNext). */
export function tokenFromCookieHeader(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const prefix = `${SESSION_COOKIE}=`;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const value = trimmed.slice(prefix.length).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/** First session token found on the native header, Cookie header, or cookie jar. */
export function sessionTokenFromHeaders(
  headerStore: { get(name: string): string | null },
  cookieValue?: string | null
): string | null {
  const header = headerStore.get(SESSION_HEADER)?.trim();
  if (header) return header;
  const fromCookieHeader = tokenFromCookieHeader(headerStore.get("cookie"));
  if (fromCookieHeader) return fromCookieHeader;
  const fromCookie = cookieValue?.trim();
  return fromCookie || null;
}

/** True when the request carries a session cookie or the native session header. */
export function hasRequestSession(
  headerStore: { get(name: string): string | null },
  cookieValue?: string | null
): boolean {
  return Boolean(sessionTokenFromHeaders(headerStore, cookieValue));
}

/**
 * Copy the session onto both Cookie and x-ciciro-session. React Native often
 * cannot set Cookie; OpenNext's cookie jar often misses the native header.
 */
export function applySessionHeaders(headers: Headers, token: string): Headers {
  if (!headers.get(SESSION_HEADER)?.trim()) {
    headers.set(SESSION_HEADER, token);
  }
  if (!tokenFromCookieHeader(headers.get("cookie"))) {
    const existing = headers.get("cookie")?.trim();
    headers.set(
      "cookie",
      existing ? `${existing}; ${SESSION_COOKIE}=${token}` : `${SESSION_COOKIE}=${token}`
    );
  }
  return headers;
}

/** Clone a Request so OpenNext sees a Cookie even when the phone only sent the header. */
export function requestWithSessionHeaders(request: Request): Request {
  const token = sessionTokenFromHeaders(request.headers);
  if (!token) return request;
  const headers = applySessionHeaders(new Headers(request.headers), token);
  return new Request(request, { headers });
}

export function isNativeClient(req: { headers: Headers }): boolean {
  return req.headers.get(NATIVE_CLIENT_HEADER)?.toLowerCase() === NATIVE_CLIENT_VALUE;
}

/** Native apps persist this token; browsers keep using the httpOnly cookie only. */
export function sessionResponseBody<T extends Record<string, unknown>>(
  body: T,
  token: string,
  native: boolean
): T | (T & { token: string }) {
  return native && token ? { ...body, token } : body;
}

// How long a freshly issued session is valid.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const MIN_PASSWORD_LENGTH = 8;
