import { NextResponse, type NextRequest } from "next/server";
import type { JWTVerifyGetKey } from "jose";
import { nativePlatform, safeNext, SESSION_COOKIE, sessionCookieOptions, type NativePlatform } from "@/lib/auth/constants";
import { captureServerEvent } from "@/lib/analytics-server";
import { waitUntilRequest } from "@/lib/db";
import {
  createHandoff,
  signInWithIdentity,
  SocialAuthError,
  type SocialSignInResult,
} from "@/lib/auth/identity";
import {
  appleClientSecret,
  AUTHORIZE_URL,
  exchangeCode,
  IdTokenError,
  pkceChallenge,
  randomToken,
  sha256Hex,
  verifyIdToken,
} from "@/lib/auth/oidc";
import {
  appleConfig,
  browserFlowEnabled,
  googleConfig,
  socialAvailability,
  type SocialProvider,
} from "@/lib/auth/social-config";
import { AuthError, createSession } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/public-origin";

// The browser flow for Sign in with Apple and Google, and the native Apple
// sheet's token sign-in. Browser flow:
//
//   GET  /api/auth/oauth/:provider/start     sets the flow cookie, redirects out
//   GET  /api/auth/oauth/google/callback     Google returns with ?code
//   POST /api/auth/oauth/apple/callback      Apple posts code + id_token
//
// The web ends with a session cookie and a redirect to `next`. The phone
// starts the same flow in a system browser with a PKCE challenge and ends at
// ciciro://oauth?code=..., which it redeems at /api/auth/handoff.

/** Where the browser flow returns to the app. Matches `scheme` in app.json. */
export const NATIVE_REDIRECT = "ciciro://oauth";

/**
 * The query parameter, on the web landing URL and on ciciro://oauth, that names
 * the provider which took over an unverified password account. It only drives
 * a one-time notice; the takeover itself already happened on the server.
 */
export const TAKEOVER_PARAM = "password_removed";

/**
 * One-time query params on the web landing URL that let the client fire the
 * right analytics event (account_created or signed_in) for a sign-in that
 * finished server-side, via redirect, with no client fetch() to hook. See
 * src/components/AnalyticsProvider.tsx.
 */
export const AUTH_EVENT_PARAM = "auth_event";
export const AUTH_PROVIDER_PARAM = "auth_provider";

export const OAUTH_COOKIE = "ciciro_oauth";
const OAUTH_COOKIE_PATH = "/api/auth/oauth";
const FLOW_TTL_S = 10 * 60;

/** Every `?error=` a failed sign-in reports to the login screen or the app. */
export type SocialFailure =
  | "cancelled"
  | "expired"
  | "unavailable"
  | "failed"
  | "no_email"
  | "unverified_email";

/** Injectable network edges, so tests run with local keys and no network. */
export type SocialDeps = {
  fetch?: typeof fetch;
  keys?: Partial<Record<SocialProvider, JWTVerifyGetKey>>;
};

/** What the flow cookie remembers between the redirect out and the callback. */
export type OAuthFlow = {
  provider: SocialProvider;
  state: string;
  nonce: string;
  /** PKCE verifier for Google's code exchange. */
  verifier: string;
  /** Web: the path to land on after signing in. */
  next: string;
  /** Native: the app's PKCE challenge for the hand-off. */
  challenge?: string;
  /** Native: the app's OS, for analytics. */
  platform?: NativePlatform;
  /** The signup screen's marketing checkbox, carried across the redirect. */
  marketingOptIn?: boolean;
};

export function encodeFlow(flow: OAuthFlow): string {
  return Buffer.from(JSON.stringify(flow)).toString("base64url");
}

export function decodeFlow(raw: string | undefined): OAuthFlow | null {
  if (!raw) return null;
  try {
    const flow = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OAuthFlow>;
    if (
      (flow.provider !== "apple" && flow.provider !== "google") ||
      typeof flow.state !== "string" ||
      typeof flow.nonce !== "string" ||
      typeof flow.verifier !== "string" ||
      typeof flow.next !== "string"
    ) {
      return null;
    }
    return {
      provider: flow.provider,
      state: flow.state,
      nonce: flow.nonce,
      verifier: flow.verifier,
      next: safeNext(flow.next),
      challenge: typeof flow.challenge === "string" ? flow.challenge : undefined,
      platform: typeof flow.challenge === "string" ? nativePlatform(flow.platform) : undefined,
      marketingOptIn: flow.marketingOptIn === true,
    };
  } catch {
    return null;
  }
}

function callbackUrl(origin: string, provider: SocialProvider): string {
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

/** The provider's authorization URL for a flow. */
export function authorizeUrl(flow: OAuthFlow, origin: string): string {
  const params = new URLSearchParams({
    redirect_uri: callbackUrl(origin, flow.provider),
    state: flow.state,
    nonce: flow.nonce,
  });
  if (flow.provider === "apple") {
    params.set("client_id", appleConfig().servicesId);
    // Apple only returns the name and email scopes with form_post, and
    // including id_token hands us the token without a second round trip.
    params.set("response_type", "code id_token");
    params.set("response_mode", "form_post");
    params.set("scope", "name email");
  } else {
    params.set("client_id", googleConfig().clientId);
    params.set("response_type", "code");
    params.set("scope", "openid email profile");
    params.set("code_challenge", pkceChallenge(flow.verifier));
    params.set("code_challenge_method", "S256");
    params.set("prompt", "select_account");
  }
  // Spaces as %20, the form Apple documents (URLSearchParams writes "+", and
  // encodes a literal "+" as %2B, so this only touches spaces).
  return `${AUTHORIZE_URL[flow.provider]}?${params.toString().replace(/\+/g, "%20")}`;
}

/**
 * Apple returns with a cross-site POST, which only carries SameSite=None
 * cookies (and those must be Secure; browsers treat localhost as secure).
 * Google returns with a top-level GET, so Lax is enough.
 */
function flowCookieOptions(provider: SocialProvider) {
  const apple = provider === "apple";
  return {
    httpOnly: true,
    sameSite: apple ? ("none" as const) : ("lax" as const),
    secure: apple || process.env.NODE_ENV === "production",
    path: OAUTH_COOKIE_PATH,
    maxAge: FLOW_TTL_S,
  };
}

function nativeFailure(code: SocialFailure): NextResponse {
  return NextResponse.redirect(`${NATIVE_REDIRECT}?error=${code}`, 303);
}

function webFailure(origin: string, code: SocialFailure, next = "/"): NextResponse {
  const url = new URL("/login", origin);
  url.searchParams.set("error", code);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
}

function clearFlowCookie(res: NextResponse, provider: SocialProvider): NextResponse {
  res.cookies.set(OAUTH_COOKIE, "", { ...flowCookieOptions(provider), maxAge: 0 });
  return res;
}

/** GET /api/auth/oauth/:provider/start */
export function startBrowserSignIn(req: NextRequest, provider: SocialProvider): NextResponse {
  // The redirect_uri must match the one registered with Apple and Google
  // exactly, so a host behind a TLS-terminating proxy sets CICIRO_PUBLIC_URL.
  const origin = publicOrigin(req.nextUrl.origin);
  const params = req.nextUrl.searchParams;
  const native = params.get("client") === "native";
  const next = safeNext(params.get("next"));

  if (!browserFlowEnabled(provider)) {
    return native ? nativeFailure("unavailable") : webFailure(origin, "unavailable", next);
  }
  const challenge = params.get("challenge") ?? "";
  // A S256 challenge is 43 base64url characters.
  if (native && !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return nativeFailure("failed");

  const flow: OAuthFlow = {
    provider,
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    next,
    challenge: native ? challenge : undefined,
    platform: native ? nativePlatform(params.get("platform")) : undefined,
    marketingOptIn: params.get("marketingOptIn") === "1",
  };
  const res = NextResponse.redirect(authorizeUrl(flow, origin), 303);
  res.cookies.set(OAUTH_COOKIE, encodeFlow(flow), flowCookieOptions(provider));
  return res;
}

/** What the provider sent back, from the query (Google) or the form (Apple). */
export type CallbackParams = {
  state: string | null;
  code: string | null;
  idToken: string | null;
  error: string | null;
  /** Apple's first-authorization `user` JSON, carrying the name. */
  user: string | null;
};

/** Apple's `user` form field: {"name":{"firstName","lastName"},"email"}. */
export function appleUserName(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const name = (JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } }).name;
    return joinName(name?.firstName, name?.lastName);
  } catch {
    return "";
  }
}

export function joinName(first: unknown, last: unknown): string {
  return [first, last]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim())
    .join(" ")
    .slice(0, 200);
}

async function appleRefreshToken(
  code: string | null,
  clientId: string,
  redirectUri: string | undefined,
  deps: SocialDeps
): Promise<{ token: string; clientId: string } | undefined> {
  if (!code) return undefined;
  // Best effort: the ID token already proved who this is. The refresh token is
  // only what account deletion will revoke, and the next sign-in retries.
  try {
    const config = appleConfig();
    const exchanged = await exchangeCode(
      "apple",
      { code, clientId, clientSecret: await appleClientSecret(config, clientId), redirectUri },
      deps.fetch
    );
    return exchanged.refreshToken ? { token: exchanged.refreshToken, clientId } : undefined;
  } catch (error) {
    console.error("apple: code exchange failed:", error instanceof Error ? error.message : error);
    return undefined;
  }
}

async function identifyFromCallback(
  flow: OAuthFlow,
  params: CallbackParams,
  origin: string,
  deps: SocialDeps
): Promise<SocialSignInResult> {
  const redirectUri = callbackUrl(origin, flow.provider);
  if (flow.provider === "apple") {
    const config = appleConfig();
    const identity = await verifyIdToken("apple", params.idToken ?? "", {
      audiences: [config.servicesId],
      nonce: flow.nonce,
      keys: deps.keys?.apple,
    });
    const refreshToken = await appleRefreshToken(params.code, config.servicesId, redirectUri, deps);
    return signInWithIdentity(identity, {
      name: appleUserName(params.user),
      refreshToken,
      origin,
      marketingOptIn: flow.marketingOptIn,
    });
  }

  const config = googleConfig();
  if (!params.code) throw new IdTokenError("google: callback without a code");
  const exchanged = await exchangeCode(
    "google",
    {
      code: params.code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri,
      codeVerifier: flow.verifier,
    },
    deps.fetch
  );
  const identity = await verifyIdToken("google", exchanged.idToken, {
    audiences: [config.clientId],
    nonce: flow.nonce,
    keys: deps.keys?.google,
  });
  return signInWithIdentity(identity, { origin, marketingOptIn: flow.marketingOptIn });
}

function failureCode(error: unknown): SocialFailure {
  if (error instanceof SocialAuthError) return error.code;
  return "failed";
}

/** GET|POST /api/auth/oauth/:provider/callback */
export async function finishBrowserSignIn(
  req: NextRequest,
  provider: SocialProvider,
  params: CallbackParams,
  deps: SocialDeps = {}
): Promise<NextResponse> {
  const origin = publicOrigin(req.nextUrl.origin);
  const flow = decodeFlow(req.cookies.get(OAUTH_COOKIE)?.value);
  const native = Boolean(flow?.challenge);
  const fail = (code: SocialFailure) =>
    clearFlowCookie(native ? nativeFailure(code) : webFailure(origin, code, flow?.next), provider);

  // No cookie (expired, another browser) or a state that is not ours: this
  // callback was not started here, so it must not sign anyone in.
  if (!flow || flow.provider !== provider || !params.state || params.state !== flow.state) {
    return fail("expired");
  }
  if (params.error) {
    // Google: access_denied. Apple: user_cancelled_authorize.
    const cancelled = /denied|cancel/i.test(params.error);
    return fail(cancelled ? "cancelled" : "failed");
  }
  if (!browserFlowEnabled(provider)) return fail("unavailable");

  let result: SocialSignInResult;
  try {
    result = await identifyFromCallback(flow, params, origin, deps);
  } catch (error) {
    if (!(error instanceof SocialAuthError)) {
      console.error(`${provider} sign-in failed:`, error instanceof Error ? error.message : error);
    }
    return fail(failureCode(error));
  }

  const { user, takeover, created } = result;
  if (created) {
    waitUntilRequest(
      captureServerEvent(user.id, "account_created", {
        method: provider,
        platform: flow.challenge ? nativePlatform(flow.platform) : "web",
      })
    );
  }
  if (flow.challenge) {
    const code = await createHandoff(user.id, flow.challenge);
    const notice = takeover ? `&${TAKEOVER_PARAM}=${takeover}` : "";
    const authEvent = `&${AUTH_EVENT_PARAM}=${created ? "account_created" : "signed_in"}&${AUTH_PROVIDER_PARAM}=${provider}`;
    return clearFlowCookie(
      NextResponse.redirect(`${NATIVE_REDIRECT}?code=${encodeURIComponent(code)}${notice}${authEvent}`, 303),
      provider
    );
  }

  const token = await createSession(user.id, req.headers.get("user-agent") || "");
  const landing = new URL(flow.next, origin);
  if (takeover) landing.searchParams.set(TAKEOVER_PARAM, takeover);
  landing.searchParams.set(AUTH_EVENT_PARAM, created ? "account_created" : "signed_in");
  landing.searchParams.set(AUTH_PROVIDER_PARAM, provider);
  const res = NextResponse.redirect(landing, 303);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return clearFlowCookie(res, provider);
}

/**
 * POST /api/auth/apple/native: the iOS Sign in with Apple sheet. The app hands
 * Apple the SHA-256 of a raw nonce it keeps, then sends the raw nonce here, so
 * a token lifted from elsewhere cannot be replayed without it.
 */
export async function signInWithAppleNative(
  input: {
    idToken: unknown;
    nonce: unknown;
    authorizationCode?: unknown;
    givenName?: unknown;
    familyName?: unknown;
    /** Public origin for the welcome email a new account gets (see publicOrigin). */
    origin?: string;
    /** The app's signup screen marketing checkbox. */
    marketingOptIn?: unknown;
  },
  deps: SocialDeps = {}
): Promise<SocialSignInResult> {
  if (!socialAvailability().apple.native) {
    throw new AuthError("Sign in with Apple is not set up on this server.", 503);
  }
  if (typeof input.idToken !== "string" || typeof input.nonce !== "string" || !input.nonce) {
    throw new AuthError("Sign in with Apple failed. Try again.", 400);
  }
  const config = appleConfig();
  let identity;
  try {
    identity = await verifyIdToken("apple", input.idToken, {
      audiences: [config.bundleId],
      nonce: sha256Hex(input.nonce),
      keys: deps.keys?.apple,
    });
  } catch (error) {
    console.error("apple native sign-in:", error instanceof Error ? error.message : error);
    throw new AuthError("Sign in with Apple failed. Try again.", 401);
  }
  const code = typeof input.authorizationCode === "string" ? input.authorizationCode : null;
  const refreshToken = await appleRefreshToken(code, config.bundleId, undefined, deps);
  return signInWithIdentity(identity, {
    name: joinName(input.givenName, input.familyName),
    refreshToken,
    origin: input.origin,
    marketingOptIn: input.marketingOptIn === true,
  });
}
