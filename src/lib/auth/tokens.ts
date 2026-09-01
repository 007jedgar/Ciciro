import { createHash, randomBytes } from "node:crypto";
import { MIN_PASSWORD_LENGTH, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/constants";

export { MIN_PASSWORD_LENGTH, SESSION_COOKIE, SESSION_TTL_MS };

/**
 * Generate an opaque session token. The raw value goes to the client cookie;
 * only its hash (see hashSessionToken) is persisted, so a database leak does
 * not expose usable session tokens.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 of a raw token, hex-encoded. Deterministic lookup key. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize + validate an email. Returns the lowercased email or null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 320) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

/** Returns an error message if the password is unacceptable, else null. */
export function validatePassword(raw: unknown): string | null {
  if (typeof raw !== "string") return "Password is required.";
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (raw.length > 512) return "Password is too long.";
  return null;
}
