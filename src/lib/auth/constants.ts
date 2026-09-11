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

/** True when the request carries a session cookie or the native session header. */
export function hasRequestSession(
  headerStore: { get(name: string): string | null },
  cookieValue?: string | null
): boolean {
  if (cookieValue?.trim()) return true;
  if (headerStore.get(SESSION_HEADER)?.trim()) return true;
  return Boolean(tokenFromCookieHeader(headerStore.get("cookie")));
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
