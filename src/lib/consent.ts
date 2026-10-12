// The cookie/local-storage consent contract: pure data and parsing, no
// cookie I/O (see consent-cookie.ts for the browser read/write) and no
// `next/headers` import, so this file is safe for both the server (layout.tsx
// reading the cookie for SSR) and the client (ConsentProvider.tsx). See
// docs/analytics.md's "Opt-in consent" bullet.
//
// `necessary` (the session cookie, CSRF, this consent record itself) and
// `functional` (device-local preferences such as theme, focus mode, TTS
// prefs) are always on and never asked about - they are disclosed on the
// privacy page but have no entry here. Only categories the banner can
// actually turn off belong in ConsentCategories. `marketing` is reserved in
// the product brief but has no consumer yet, so it is deliberately absent
// until something needs it - add it as a new key and bump CONSENT_VERSION
// then, not now.

export const CONSENT_COOKIE_NAME = "ciciro_consent";
// ~6 months: inside the brief's 6-12 month window.
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/**
 * Bump this whenever a category is added, removed, or its purpose changes.
 * A stored record whose version doesn't match means "ask again" - see
 * isCurrentConsentRecord.
 */
export const CONSENT_VERSION = 1;

export type ConsentCategories = {
  /** PostHog product analytics. Off until explicitly granted. */
  analytics: boolean;
};

export type ConsentRecord = {
  version: number;
  categories: ConsentCategories;
  /** ISO timestamp of the decision. */
  decidedAt: string;
};

export type ConsentCategoryInfo = {
  id: keyof ConsentCategories;
  label: string;
  description: string;
};

/** Shown in the preference center, in display order. */
export const CONSENT_CATEGORY_INFO: ConsentCategoryInfo[] = [
  {
    id: "analytics",
    label: "Analytics",
    description:
      "Lets us see which features are used, with PostHog, so we know what to improve. Off by default. Never your manuscript text, chat content, or titles.",
  },
];

export function defaultConsentCategories(): ConsentCategories {
  return { analytics: false };
}

export function buildConsentRecord(categories: ConsentCategories, now: Date = new Date()): ConsentRecord {
  return { version: CONSENT_VERSION, categories: { ...categories }, decidedAt: now.toISOString() };
}

function isConsentCategories(value: unknown): value is ConsentCategories {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).analytics === "boolean";
}

function isConsentRecordShape(value: unknown): value is ConsentRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.version === "number" && typeof v.decidedAt === "string" && isConsentCategories(v.categories);
}

/** A record only counts as a real decision when its version matches exactly - an older or newer version means ask again. */
export function isCurrentConsentRecord(value: unknown): value is ConsentRecord {
  return isConsentRecordShape(value) && value.version === CONSENT_VERSION;
}

/** Parse a raw cookie value into a current-version record, or null (no decision yet, or one that needs re-asking). */
export function parseConsentRecord(raw: string | null | undefined): ConsentRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isCurrentConsentRecord(parsed) ? parsed : null;
}

export function serializeConsentRecord(record: ConsentRecord): string {
  return JSON.stringify(record);
}

/**
 * Global Privacy Control: a live per-visit browser/extension signal, not a
 * stored decision. ConsentProvider honors it as "reject all for analytics"
 * only while no explicit record exists yet for this device - an existing
 * explicit choice (accept or reject) is never overridden by it, and the
 * banner still shows either way so a visitor can make a real categorized
 * choice. See docs/analytics.md's "Opt-in consent" bullet and the privacy page.
 */
export function honorsGlobalPrivacyControl(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}
