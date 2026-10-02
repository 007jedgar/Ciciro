/**
 * Pure helpers for Sign in with Apple / Google. Kept free of native modules so
 * the button choice and the redirect parsing can be unit-tested directly; the
 * native calls live in social-sign-in.ts.
 *
 * Apple on iOS uses the system sheet and posts its ID token to the server.
 * Everything else (Google on both platforms, Apple on Android) runs the
 * server's browser flow in a system browser and comes back to
 * ciciro://oauth?code=..., which the app redeems with its PKCE verifier.
 */

/** GET /api/auth/providers. Absent (older server) reads as nothing configured. */
export type SocialProviders = {
  apple: { web: boolean; native: boolean };
  google: boolean;
};

export const NO_SOCIAL_PROVIDERS: SocialProviders = {
  apple: { web: false, native: false },
  google: false,
};

export type BrowserProvider = "apple" | "google";

export type SocialButton =
  /** The iOS Sign in with Apple sheet. */
  | "apple-native"
  /** Apple's web flow in a system browser (Android). */
  | "apple-browser"
  | "google";

/** Must match NATIVE_REDIRECT on the server and `scheme` in app.json. */
export const NATIVE_REDIRECT = "ciciro://oauth";

/** Which buttons to show, in order. Apple first, per Apple's guidelines. */
export function socialButtons(
  providers: SocialProviders,
  platform: string,
  appleSheetAvailable: boolean
): SocialButton[] {
  const buttons: SocialButton[] = [];
  if (platform === "ios") {
    if (providers.apple.native && appleSheetAvailable) buttons.push("apple-native");
  } else if (providers.apple.web) {
    buttons.push("apple-browser");
  }
  if (providers.google) buttons.push("google");
  return buttons;
}

/** Where the system browser starts the server's flow. */
export function browserStartUrl(
  apiUrl: string,
  provider: BrowserProvider,
  challenge: string,
  platform: string,
  marketingOptIn = false
): string {
  const opt = marketingOptIn ? "&marketingOptIn=1" : "";
  return `${apiUrl}/api/auth/oauth/${provider}/start?client=native&challenge=${encodeURIComponent(challenge)}&platform=${encodeURIComponent(platform)}${opt}`;
}

/** Every `?error=` the server's flow can send back (SocialFailure there). */
export type SocialErrorKey =
  | "cancelled"
  | "expired"
  | "unavailable"
  | "failed"
  | "no_email"
  | "unverified_email";

const ERROR_KEYS: readonly SocialErrorKey[] = [
  "cancelled",
  "expired",
  "unavailable",
  "failed",
  "no_email",
  "unverified_email",
];

export function toSocialErrorKey(value: unknown): SocialErrorKey {
  return ERROR_KEYS.includes(value as SocialErrorKey) ? (value as SocialErrorKey) : "failed";
}

/** A failed social sign-in, carrying the translation key for its message. */
export class SocialSignInError extends Error {
  key: SocialErrorKey;
  constructor(key: SocialErrorKey) {
    super(`social sign-in failed: ${key}`);
    this.name = "SocialSignInError";
    this.key = key;
  }
}

/** Read the redirect the browser flow ended on. */
export function parseRedirect(
  url: string
):
  | { code: string; takeover?: BrowserProvider; created: boolean; provider?: BrowserProvider }
  | { error: SocialErrorKey } {
  const query = url.startsWith(NATIVE_REDIRECT) ? url.slice(NATIVE_REDIRECT.length) : "";
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : "");
  const code = params.get("code");
  if (code) {
    const takeoverParam = params.get("password_removed");
    const takeover = takeoverParam === "apple" || takeoverParam === "google" ? takeoverParam : undefined;
    const providerParam = params.get("auth_provider");
    const provider = providerParam === "apple" || providerParam === "google" ? providerParam : undefined;
    const created = params.get("auth_event") === "account_created";
    return { code, takeover, created, provider };
  }
  return { error: toSocialErrorKey(params.get("error")) };
}

/** Base64 to base64url, unpadded (RFC 7636's encoding for PKCE). */
export function base64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Bytes to base64url, for the verifier and the raw nonce. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return base64Url(btoa(binary));
}

/** Join Apple's name parts the way the server does. */
export function joinName(given?: string | null, family?: string | null): string {
  return [given, family]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim())
    .join(" ");
}
