// The "wash" that changes the app's theme: new paper spreads from the spot that
// was tapped until it covers everything, the theme swaps underneath, and the
// paper fades away to reveal the app already wearing it. One state, read by
// `ThemeWashHost` at the root (and inside modal-presented screens like Settings,
// which sit above it) so the Settings sheet and the onboarding step share it.
// See AGENTS.md "Pre-signup onboarding".

export const WASH_SPREAD_MS = 420;
export const WASH_FADE_MS = 260;

export type ThemeWash = {
  id: number;
  x: number;
  y: number;
  color: string;
  /** Runs once the paper covers the screen, when the theme is swapped. */
  apply: () => void;
};

let current: ThemeWash | null = null;
let appliedId = 0;
let nextId = 1;
const listeners = new Set<() => void>();

export function getThemeWash(): ThemeWash | null {
  return current;
}

export function subscribeThemeWash(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Starts a wash from (x, y) in window coordinates. Returns false when one is
 * already playing, so a second tap mid-wash is ignored rather than stacked.
 */
export function startThemeWash(wash: Omit<ThemeWash, "id">): boolean {
  if (current) return false;
  current = { ...wash, id: nextId++ };
  emit();
  return true;
}

/**
 * Swaps the theme, once per wash however many hosts are painting it (a screen
 * presented as a modal is above the root host, so it mounts its own).
 */
export function applyThemeWash(id: number): void {
  if (current?.id !== id || appliedId === id) return;
  appliedId = id;
  current.apply();
}

export function finishThemeWash(id: number): void {
  if (current?.id !== id) return;
  current = null;
  emit();
}
