// Pure auth constants with no runtime dependencies. Safe to import from the
// Edge middleware (which cannot bundle node:crypto). Crypto-backed helpers live
// in tokens.ts / session.ts (Node runtime only).

// The session cookie name. httpOnly so client JS cannot read it.
export const SESSION_COOKIE = "ciciro_session";

// How long a freshly issued session is valid.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const MIN_PASSWORD_LENGTH = 8;
