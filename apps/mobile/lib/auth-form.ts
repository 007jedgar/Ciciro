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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export type AuthFieldErrors = {
  email?: string;
  password?: string;
};

/** Validate the email/password pair for the given mode. Name is always optional. */
export function validateAuthFields(
  mode: AuthMode,
  fields: { email: string; password: string }
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const email = fields.email.trim();
  if (!email) {
    errors.email = "Enter your email.";
  } else if (!EMAIL_RE.test(email)) {
    errors.email = "Enter a valid email.";
  }

  if (!fields.password) {
    errors.password = "Enter your password.";
  } else if (mode === "signup" && fields.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return errors;
}
