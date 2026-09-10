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
