import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  parseConsentRecord,
  serializeConsentRecord,
  type ConsentRecord,
} from "@/lib/consent";

// Browser-only read/write for the ciciro_consent cookie. Not httpOnly (the
// client needs to read and change it without a round trip), SameSite=Lax,
// Secure on https (dropped on http so local dev over plain http still
// works - see AGENTS.md "Dev Estimates" n/a, this is just a dev convenience).

function readRawCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

export function readConsentCookie(): ConsentRecord | null {
  return parseConsentRecord(readRawCookie(CONSENT_COOKIE_NAME));
}

export function writeConsentCookie(record: ConsentRecord): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(serializeConsentRecord(record))}; Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}
