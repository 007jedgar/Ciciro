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
// Native clients also send their OS ("ios" | "android") so server-side
// analytics can label the platform.
export const CLIENT_PLATFORM_HEADER = "x-ciciro-platform";

export type ClientPlatform = "web" | "ios" | "android";
export type NativePlatform = Exclude<ClientPlatform, "web">;

/** A native OS name from a header or query value; anything else (an older app build) reads as iOS. */
export function nativePlatform(value: string | null | undefined): NativePlatform {
  return value?.toLowerCase() === "android" ? "android" : "ios";
}

/** Hosted deployments set this so anonymous traffic cannot list every manuscript. */
export function authRequired(): boolean {
  return process.env["CICIRO_REQUIRE_AUTH"] === "true";
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Every session token a header or cookie value can hold. iOS joins a cookie
 * from its jar and the app's own Cookie header with a comma, so a `;`-only
 * parser reads one value, `TOKEN,ciciro_session=TOKEN` (URL-encoded in the
 * jar). A phone that stored that value sends it back in x-ciciro-session too.
 * Tokens are base64url, so a comma, semicolon or `=` never belongs to one.
 */
export function sessionTokenCandidates(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const prefix = `${SESSION_COOKIE}=`;
  const tokens: string[] = [];
  for (const part of decoded(raw).split(/[;,]/)) {
    let token = part.trim();
    if (token.startsWith(prefix)) token = token.slice(prefix.length).trim();
    if (!token || token.includes("=") || tokens.includes(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

/** Every session token in a raw Cookie header (React Native / OpenNext), in order. */
export function sessionTokensFromCookieHeader(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const prefix = `${SESSION_COOKIE}=`;
  const tokens: string[] = [];
  for (const part of raw.split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    for (const token of sessionTokenCandidates(trimmed.slice(prefix.length))) {
      if (!tokens.includes(token)) tokens.push(token);
    }
  }
  return tokens;
}

/** Pull the session token out of a raw Cookie header (React Native / OpenNext). */
export function tokenFromCookieHeader(raw: string | null | undefined): string | null {
  return sessionTokensFromCookieHeader(raw)[0] ?? null;
}

/** First session token found on the native header, Cookie header, or cookie jar. */
export function sessionTokenFromHeaders(
  headerStore: { get(name: string): string | null },
  cookieValue?: string | null
): string | null {
  return (
    sessionTokenCandidates(headerStore.get(SESSION_HEADER))[0] ??
    tokenFromCookieHeader(headerStore.get("cookie")) ??
    sessionTokenCandidates(cookieValue)[0] ??
    null
  );
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

/** Which client sent the request: the browser, or the native app on iOS or Android. */
export function clientPlatform(req: { headers: Headers }): ClientPlatform {
  if (!isNativeClient(req)) return "web";
  return nativePlatform(req.headers.get(CLIENT_PLATFORM_HEADER));
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

/** Cookie flags for `ciciro_session`. Shared by `cookies().set` and Set-Cookie. */
export function sessionCookieOptions(expires = new Date(Date.now() + SESSION_TTL_MS)) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

export const MIN_PASSWORD_LENGTH = 8;

/** A post-sign-in `next` path, same-origin only: `//host` and `/\host` leave the site. */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
