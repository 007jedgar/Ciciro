import { useSyncExternalStore } from "react";

/**
 * On-device analytics/privacy consent (GDPR/ePrivacy opt-in), separate from
 * the account-level `analyticsEnabled` setting in app-settings.ts. This is
 * per-device, never synced: ePrivacy asks before a device stores or reads an
 * identifier, so a second device (or a reinstall) must ask again even for an
 * account that already said yes elsewhere. See docs/analytics.md.
 *
 * `necessary` (session/auth, security, this consent record itself) and
 * `functional` (theme, focus mode, editor/reader prefs - user-requested
 * storage) are always on and not part of the decision; only `analytics` is
 * gated here. `marketing` is a reserved category id for later use and has no
 * toggle or consumer yet.
 */

/** Bump whenever a category or its purpose changes; an older-version record means "ask again". */
export const CONSENT_VERSION = 1;

export type ConsentCategories = {
  analytics: boolean;
};

export type ConsentRecord = {
  version: number;
  categories: ConsentCategories;
  decidedAt: string;
};

const CONSENT_KEY = "privacy-consent";

let cached: ConsentRecord | null | undefined;
const listeners = new Set<() => void>();

function parseRecord(raw: string): ConsentRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentRecord> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.version !== "number") return null;
    if (typeof parsed.decidedAt !== "string") return null;
    const analytics = parsed.categories?.analytics === true;
    return { version: parsed.version, categories: { analytics }, decidedAt: parsed.decidedAt };
  } catch {
    return null;
  }
}

function readStored(): ConsentRecord | null {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const raw = getPrefs().getString(CONSENT_KEY);
    return raw ? parseRecord(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(record: ConsentRecord): void {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(CONSENT_KEY, JSON.stringify(record));
  } catch {
    /* web / tests / missing native module */
  }
}

/** The device's current consent record, or null if never decided. */
export function getConsent(): ConsentRecord | null {
  if (cached === undefined) cached = readStored();
  return cached;
}

/** True when nobody has decided on this device, or they decided under an older version. */
export function needsConsentPrompt(record: ConsentRecord | null): boolean {
  return !record || record.version !== CONSENT_VERSION;
}

/** Records a decision for the current version and notifies subscribers. Analytics-layer side effects live in analytics-client.ts / AnalyticsSync, not here. */
export function decideConsent(categories: ConsentCategories, now: () => number = Date.now): ConsentRecord {
  const record: ConsentRecord = {
    version: CONSENT_VERSION,
    categories: { analytics: categories.analytics === true },
    decidedAt: new Date(now()).toISOString(),
  };
  cached = record;
  writeStored(record);
  for (const listener of listeners) listener();
  return record;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The device's consent record, reactive to decideConsent() calls anywhere in the app. */
export function useConsent(): ConsentRecord | null {
  return useSyncExternalStore(subscribe, getConsent, getConsent);
}

/**
 * Whether analytics may actually run right now: consent granted on this
 * device AND (nobody signed in, or the signed-in account's own
 * `analyticsEnabled` agrees). A device that never decided, or said no, is
 * always false regardless of any account setting.
 */
export function effectiveAnalyticsAllowed(input: {
  record: ConsentRecord | null;
  signedIn: boolean;
  accountEnabled: boolean;
}): boolean {
  if (input.record?.categories.analytics !== true) return false;
  return !input.signedIn || input.accountEnabled;
}
