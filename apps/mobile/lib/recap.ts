// "Previously on" and "I'm stuck" on the phone. Mirrors the rules in
// src/lib/recap-view.ts; the server writes both, this decides when to ask.

/** Away at least this long and the recap greets the author on open. */
export const RECAP_ABSENCE_MS = 12 * 60 * 60 * 1000;

/** Show the recap only after a real absence; a first open has nothing to recap. */
export function shouldShowRecap(lastOpenedAt: number | null, now: number): boolean {
  if (lastOpenedAt == null || !Number.isFinite(lastOpenedAt)) return false;
  return now - lastOpenedAt >= RECAP_ABSENCE_MS;
}

const KEY_PREFIX = "recap-opened:";

function readOpened(projectId: string): number | null {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const raw = getPrefs().getString(KEY_PREFIX + projectId);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null; // web / tests / missing native module
  }
}

function writeOpened(projectId: string, at: number) {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(KEY_PREFIX + projectId, String(at));
  } catch {
    /* web / tests / missing native module */
  }
}

const decided = new Map<string, boolean>();
const dismissed = new Set<string>();

/**
 * Whether this manuscript's recap is due. Decided once per app run, when the
 * manuscript is first opened, so switching tabs never brings it back.
 */
export function recapDue(projectId: string, now = Date.now()): boolean {
  if (!projectId) return false;
  let due = decided.get(projectId);
  if (due === undefined) {
    due = shouldShowRecap(readOpened(projectId), now);
    decided.set(projectId, due);
    writeOpened(projectId, now);
  }
  return due && !dismissed.has(projectId);
}

export function dismissRecap(projectId: string) {
  dismissed.add(projectId);
}

/** The Ciciro tab with a stuck prompt waiting in the composer. */
export function stuckPromptHref(projectId: string, prompt: string): string {
  return `/project/${encodeURIComponent(projectId)}/ciciro?prompt=${encodeURIComponent(prompt)}`;
}

/** Test seam: forget this run's decisions. */
export function resetRecapState() {
  decided.clear();
  dismissed.clear();
}
