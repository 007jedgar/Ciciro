import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { API_URL } from "./api/client";
import {
  base64Url,
  browserStartUrl,
  bytesToBase64Url,
  NATIVE_REDIRECT,
  parseRedirect,
  SocialSignInError,
  type BrowserProvider,
} from "./social-auth";

// The native halves of Sign in with Apple / Google. Each returns what the
// server needs, or null when the person backed out.

export type AppleCredential = {
  idToken: string;
  /** Raw nonce; Apple's token carries its SHA-256. */
  nonce: string;
  authorizationCode: string | null;
  givenName: string | null;
  familyName: string | null;
};

function randomUrlSafe(bytes = 32): string {
  return bytesToBase64Url(Crypto.getRandomBytes(bytes));
}

/** The iOS Sign in with Apple sheet. */
export async function appleSheetCredential(): Promise<AppleCredential | null> {
  const nonce = randomUrlSafe();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
  } catch (error) {
    // CANCELED: the person closed the sheet. UNKNOWN (ASAuthorizationError
    // 1000): they closed the system's own "sign in to your Apple Account"
    // prompt, which already said what was wrong.
    const code = (error as { code?: string }).code;
    if (code === "ERR_REQUEST_CANCELED" || code === "ERR_REQUEST_UNKNOWN") return null;
    throw new SocialSignInError("failed");
  }
  if (!credential.identityToken) throw new SocialSignInError("failed");
  return {
    idToken: credential.identityToken,
    nonce,
    authorizationCode: credential.authorizationCode,
    // Apple sends the name on the first authorization only.
    givenName: credential.fullName?.givenName ?? null,
    familyName: credential.fullName?.familyName ?? null,
  };
}

export async function appleSheetAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Run the server's browser flow in a system browser (ASWebAuthenticationSession
 * on iOS, a Custom Tab on Android). Returns the one-time code and the verifier
 * that redeems it.
 */
export async function browserSignInCode(
  provider: BrowserProvider,
  marketingOptIn = false
): Promise<
  | { code: string; verifier: string; takeover?: BrowserProvider; created: boolean; provider?: BrowserProvider }
  | null
> {
  const verifier = randomUrlSafe();
  const challenge = base64Url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    })
  );
  const result = await WebBrowser.openAuthSessionAsync(
    browserStartUrl(API_URL, provider, challenge, marketingOptIn),
    NATIVE_REDIRECT
  );
  if (result.type !== "success") return null;
  const parsed = parseRedirect(result.url);
  if ("error" in parsed) {
    if (parsed.error === "cancelled") return null;
    throw new SocialSignInError(parsed.error);
  }
  return {
    code: parsed.code,
    verifier,
    takeover: parsed.takeover,
    created: parsed.created,
    provider: parsed.provider,
  };
}
