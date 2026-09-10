/**
 * Pure helpers for the sign-in / create-account screen. Kept free of React and
 * native modules so the mode logic can be unit-tested directly.
 */
export type AuthMode = "signin" | "signup";

/** The mode you switch to from the current one. */
export function otherMode(mode: AuthMode): AuthMode {
  return mode === "signin" ? "signup" : "signin";
}

/** The name field belongs to account creation only. */
export function nameFieldVisible(mode: AuthMode): boolean {
  return mode === "signup";
}

/** Animation target: 1 reveals the name field, 0 collapses it. */
export function modeProgress(mode: AuthMode): 0 | 1 {
  return mode === "signup" ? 1 : 0;
}

/**
 * Resolve the name row's height from a layout measurement. A measurement can
 * come back as 0 when the row is measured while collapsed (e.g. the screen was
 * entered in sign-in mode). Never let a zero measurement stick, or the row
 * stays at height 0 and can't reopen when the user switches to Create account.
 */
export function resolveNameRowHeight(measured: number, fallback: number): number {
  return Number.isFinite(measured) && measured > 0 ? measured : fallback;
}
