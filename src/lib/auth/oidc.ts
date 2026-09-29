import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { normalizeEmail } from "@/lib/auth/tokens";
import type { AppleConfig, SocialProvider } from "@/lib/auth/social-config";

// OpenID Connect plumbing for Sign in with Apple and Google: ID token
// verification against each provider's published keys, the authorization code
// exchange, and Apple's signed client secret. Pure apart from `fetch`, so tests
// pass locally generated keys and a stub fetch.

export const AUTHORIZE_URL: Record<SocialProvider, string> = {
  apple: "https://appleid.apple.com/auth/authorize",
  google: "https://accounts.google.com/o/oauth2/v2/auth",
};

const TOKEN_URL: Record<SocialProvider, string> = {
  apple: "https://appleid.apple.com/auth/token",
  google: "https://oauth2.googleapis.com/token",
};

const JWKS_URL: Record<SocialProvider, string> = {
  apple: "https://appleid.apple.com/auth/keys",
  google: "https://www.googleapis.com/oauth2/v3/certs",
};

const ISSUERS: Record<SocialProvider, string[]> = {
  apple: ["https://appleid.apple.com"],
  // Google documents both spellings.
  google: ["https://accounts.google.com", "accounts.google.com"],
};

/** Allowed skew between the provider's clock and ours when checking iat/exp. */
const CLOCK_TOLERANCE_S = 60;

/** A token that failed verification. The message is for logs, never the user. */
export class IdTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdTokenError";
  }
}

export type VerifiedIdentity = {
  provider: SocialProvider;
  /** The provider's stable user id (`sub`). */
  subject: string;
  /** Lowercased, or null when the token carries no usable email. */
  email: string | null;
  emailVerified: boolean;
  /** Display name when the token carries one (Google); Apple never does. */
  name: string;
};

// jose caches keys per set and refetches on an unknown `kid`, so keep one per
// provider for the isolate's lifetime.
const remoteKeys = new Map<SocialProvider, JWTVerifyGetKey>();

function providerKeys(provider: SocialProvider): JWTVerifyGetKey {
  let keys = remoteKeys.get(provider);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(JWKS_URL[provider]));
    remoteKeys.set(provider, keys);
  }
  return keys;
}

/** Apple sends booleans in some tokens and "true"/"false" strings in others. */
function claimIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Verify a provider ID token: signature against the provider's JWKS, issuer,
 * audience, expiry, and nonce. Throws IdTokenError on any failure.
 *
 * `nonce` is the exact value the token must carry. There is no nonce-less
 * path: every Ciciro flow sets one, so a token without it was not minted for
 * this sign-in.
 */
export async function verifyIdToken(
  provider: SocialProvider,
  idToken: string,
  options: {
    audiences: string[];
    nonce: string;
    /** Override the provider's JWKS (tests). */
    keys?: JWTVerifyGetKey;
    currentDate?: Date;
  }
): Promise<VerifiedIdentity> {
  const audiences = options.audiences.filter(Boolean);
  if (audiences.length === 0) throw new IdTokenError(`${provider}: no audience configured`);
  if (!options.nonce) throw new IdTokenError(`${provider}: no nonce to check`);
  if (typeof idToken !== "string" || !idToken) throw new IdTokenError(`${provider}: missing ID token`);

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, options.keys ?? providerKeys(provider), {
      issuer: ISSUERS[provider],
      audience: audiences,
      algorithms: ["RS256"],
      clockTolerance: CLOCK_TOLERANCE_S,
      currentDate: options.currentDate,
      requiredClaims: ["sub", "exp", "iat"],
    }));
  } catch (error) {
    throw new IdTokenError(
      `${provider}: ${error instanceof Error ? error.message : "invalid ID token"}`
    );
  }

  if (payload.nonce !== options.nonce) throw new IdTokenError(`${provider}: nonce mismatch`);
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!subject) throw new IdTokenError(`${provider}: token has no subject`);

  const email = normalizeEmail(payload.email);
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 200) : "";
  return {
    provider,
    subject,
    email,
    emailVerified: email !== null && claimIsTrue(payload.email_verified),
    name,
  };
}

/** Random URL-safe value for state, nonces, and handoff codes. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hex SHA-256. The native Apple sheet carries this of the app's raw nonce. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** PKCE S256 challenge for a verifier (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Apple's client secret: a short-lived ES256 JWT signed with the team's .p8
 * key, with `sub` set to the client_id the code was issued to (the Services ID
 * for the web flow, the bundle ID for the iOS sheet).
 */
export async function appleClientSecret(
  config: AppleConfig,
  clientId: string,
  now = new Date()
): Promise<string> {
  const key = await importPKCS8(config.privateKey, "ES256");
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 5 * 60)
    .setAudience("https://appleid.apple.com")
    .setSubject(clientId)
    .sign(key);
}

export type CodeExchange = {
  idToken: string;
  refreshToken: string;
};

/** Trade an authorization code at the provider's token endpoint. */
export async function exchangeCode(
  provider: SocialProvider,
  params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
    codeVerifier?: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<CodeExchange> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  if (params.redirectUri) body.set("redirect_uri", params.redirectUri);
  if (params.codeVerifier) body.set("code_verifier", params.codeVerifier);

  const res = await fetchImpl(TOKEN_URL[provider], {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
    throw new Error(`${provider} code exchange failed: ${reason}`);
  }
  return {
    idToken: typeof data.id_token === "string" ? data.id_token : "",
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : "",
  };
}
