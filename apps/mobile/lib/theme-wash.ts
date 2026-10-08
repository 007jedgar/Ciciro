// The "wash" that changes the app's theme: a circle opens from the spot that was
// tapped, and inside it the real screen shows, already painted in the new theme,
// while outside it the old look stays until the circle reaches it. One state,
// read by `ThemeWashScope` (at the root, and inside modal-presented screens like
// Settings, which sit above it) so the Settings sheet and the onboarding step
// share it. See AGENTS.md "Pre-signup onboarding (mobile)".

/** How long the circle takes to open. */
export const WASH_REVEAL_MS = 560;
/** The beat between swapping the theme and opening the circle, for the new look to paint under the snapshot. */
export const WASH_REPAINT_MS = 90;

export type ThemeWash = {
  id: number;
  x: number;
  y: number;
  /** Swaps the theme. Runs once, under the snapshot, just before the circle opens. */
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
 * Swaps the theme, once per wash however many scopes are painting it (a screen
 * presented as a modal is above the root scope, so it mounts its own).
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
