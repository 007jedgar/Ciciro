import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { NO_PASSWORD, redeemHandoff, signInWithIdentity, SocialAuthError } from "@/lib/auth/identity";
import { pkceChallenge, randomToken, sha256Hex, type VerifiedIdentity } from "@/lib/auth/oidc";
import { authenticate, getSessionUser, registerUser } from "@/lib/auth/session";
import { socialAvailability } from "@/lib/auth/social-config";
import {
  finishBrowserSignIn,
  OAUTH_COOKIE,
  signInWithAppleNative,
  startBrowserSignIn,
  type CallbackParams,
  type SocialDeps,
} from "@/lib/auth/social-sign-in";
import { hashSessionToken } from "@/lib/auth/tokens";
import { fakeAppleSigningKey, fakeIdp, type FakeIdp } from "./helpers/fake-idp";

const ORIGIN = "http://localhost:3000";

async function resetDb() {
  await prisma.authHandoff.deleteMany();
  await prisma.identity.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

function google(overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    provider: "google",
    subject: "g-1",
    email: "writer@gmail.com",
    emailVerified: true,
    name: "",
    ...overrides,
  };
}

describe("signInWithIdentity", () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a password-less account for a new verified email", async () => {
    const user = await signInWithIdentity(google({ name: "Ada" }));
    expect(user).toMatchObject({ email: "writer@gmail.com", name: "Ada" });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toBe(NO_PASSWORD);
    const identities = await prisma.identity.findMany({ where: { userId: user.id } });
    expect(identities).toMatchObject([{ provider: "google", subject: "g-1", email: "writer@gmail.com" }]);
  });

  it("never lets a password-less account sign in with a password", async () => {
    await signInWithIdentity(google());
    await expect(authenticate({ email: "writer@gmail.com", password: "" })).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      authenticate({ email: "writer@gmail.com", password: "anything-at-all" })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("keeps signing a known subject into its account after the email changes", async () => {
    const first = await signInWithIdentity(google());
    const again = await signInWithIdentity(google({ email: "renamed@gmail.com" }));
    expect(again.id).toBe(first.id);
    // The account email stays; only the identity's record of it moves.
    expect(again.email).toBe("writer@gmail.com");
    const identity = await prisma.identity.findFirstOrThrow({ where: { userId: first.id } });
    expect(identity.email).toBe("renamed@gmail.com");
  });

  it("links a verified email to an existing password account, which keeps its password", async () => {
    const existing = await registerUser({ email: "Writer@Gmail.com", password: "long-enough-pw" });
    const user = await signInWithIdentity(google());
    expect(user.id).toBe(existing.id);
    await expect(
      authenticate({ email: "writer@gmail.com", password: "long-enough-pw" })
    ).resolves.toMatchObject({ id: existing.id });
    expect(await prisma.user.count()).toBe(1);
  });

  it("links Apple and Google to one account through the shared email", async () => {
    const viaGoogle = await signInWithIdentity(google());
    const viaApple = await signInWithIdentity(
      google({ provider: "apple", subject: "001.apple", email: "writer@gmail.com" })
    );
    expect(viaApple.id).toBe(viaGoogle.id);
    expect(await prisma.identity.count({ where: { userId: viaGoogle.id } })).toBe(2);
  });

  it("never links or creates on an unverified email", async () => {
    await registerUser({ email: "writer@gmail.com", password: "long-enough-pw" });
    const error = await signInWithIdentity(google({ emailVerified: false })).catch((e) => e);
    expect(error).toBeInstanceOf(SocialAuthError);
    expect(error.code).toBe("unverified_email");
    await expect(
      signInWithIdentity(google({ email: "fresh@gmail.com", emailVerified: false }))
    ).rejects.toMatchObject({ code: "unverified_email" });
    expect(await prisma.identity.count()).toBe(0);
    expect(await prisma.user.count()).toBe(1);
  });

  it("refuses a first sign-in with no email", async () => {
    await expect(
      signInWithIdentity(google({ email: null, emailVerified: false }))
    ).rejects.toMatchObject({ code: "no_email" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("signs a known subject in even when a later token omits the email", async () => {
    const first = await signInWithIdentity(google({ provider: "apple", subject: "001.a" }));
    const again = await signInWithIdentity(
      google({ provider: "apple", subject: "001.a", email: null, emailVerified: false })
    );
    expect(again.id).toBe(first.id);
  });

  it("treats an Apple private-relay email as an ordinary email", async () => {
    const relay = "x7yq@privaterelay.appleid.com";
    const user = await signInWithIdentity(
      google({ provider: "apple", subject: "001.relay", email: relay })
    );
    expect(user.email).toBe(relay);
  });

  it("uses Apple's first-sign-in name only to fill an empty name", async () => {
    const identity = google({ provider: "apple", subject: "001.name" });
    const first = await signInWithIdentity(identity, { name: " Ada Lovelace " });
    expect(first.name).toBe("Ada Lovelace");
    // Apple never sends the name again, and a client cannot rename the account.
    expect((await signInWithIdentity(identity)).name).toBe("Ada Lovelace");
    expect((await signInWithIdentity(identity, { name: "Mallory" })).name).toBe("Ada Lovelace");
  });

  it("stores and refreshes the Apple refresh token", async () => {
    const identity = google({ provider: "apple", subject: "001.rt" });
    await signInWithIdentity(identity, { refreshToken: "rt-1" });
    await signInWithIdentity(identity);
    expect((await prisma.identity.findFirstOrThrow()).refreshToken).toBe("rt-1");
    await signInWithIdentity(identity, { refreshToken: "rt-2" });
    expect((await prisma.identity.findFirstOrThrow()).refreshToken).toBe("rt-2");
  });

  it("links concurrent first sign-ins to one account", async () => {
    const [a, b] = await Promise.all([signInWithIdentity(google()), signInWithIdentity(google())]);
    expect(a.id).toBe(b.id);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.identity.count()).toBe(1);
  });
});

describe("browser and native sign-in flows", () => {
  let appleIdp: FakeIdp;
  let googleIdp: FakeIdp;
  let applePem = "";

  beforeAll(async () => {
    appleIdp = await fakeIdp("apple");
    googleIdp = await fakeIdp("google");
    applePem = (await fakeAppleSigningKey()).pem;
  });

  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("GOOGLE_CLIENT_ID", "web-client.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
    vi.stubEnv("APPLE_SERVICES_ID", "app.ciciro.web");
    vi.stubEnv("APPLE_BUNDLE_ID", "app.ciciro.mobile");
    vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
    vi.stubEnv("APPLE_KEY_ID", "KEY1234567");
    // As pasted into a one-line secret.
    vi.stubEnv("APPLE_PRIVATE_KEY", applePem.replace(/\n/g, "\\n"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Stub the provider's token endpoint; records what it was sent. */
  function tokenEndpoint(reply: (body: URLSearchParams, url: string) => Record<string, unknown>) {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      calls.push({ url: String(url), body });
      return Response.json(reply(body, String(url)));
    }) as typeof fetch;
    return { calls, fetch: fetchStub };
  }

  function start(path: string) {
    const res = startBrowserSignIn(new NextRequest(`${ORIGIN}${path}`), path.includes("apple") ? "apple" : "google");
    const location = new URL(res.headers.get("location") ?? "");
    const cookie = res.cookies.get(OAUTH_COOKIE);
    return { res, location, cookie };
  }

  function callback(
    provider: "apple" | "google",
    cookieValue: string | undefined,
    params: Partial<CallbackParams>,
    deps: SocialDeps
  ) {
    const req = new NextRequest(`${ORIGIN}/api/auth/oauth/${provider}/callback`, {
      headers: cookieValue ? { cookie: `${OAUTH_COOKIE}=${cookieValue}` } : {},
    });
    return finishBrowserSignIn(
      req,
      provider,
      { state: null, code: null, idToken: null, error: null, user: null, ...params },
      deps
    );
  }

  async function sessionUserFor(token: string) {
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    return session?.user ?? null;
  }

  it("reports which providers are configured", () => {
    expect(socialAvailability()).toEqual({ apple: { web: true, native: true }, google: true });
    vi.stubEnv("APPLE_PRIVATE_KEY", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(socialAvailability()).toEqual({ apple: { web: false, native: false }, google: false });
  });

  it("Google on the web: start, callback, session, redirect to next", async () => {
    const { location, cookie } = start("/api/auth/oauth/google/start?next=/project/p1");
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = location.searchParams;
    expect(q.get("client_id")).toBe("web-client.apps.googleusercontent.com");
    expect(q.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/oauth/google/callback`);
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/auth/oauth" });

    const idToken = await googleIdp.mint({
      sub: "g-42",
      aud: "web-client.apps.googleusercontent.com",
      email: "writer@gmail.com",
      email_verified: true,
      name: "Ada Writer",
      nonce: q.get("nonce"),
    });
    const endpoint = tokenEndpoint(() => ({ id_token: idToken }));

    const res = await callback(
      "google",
      cookie?.value,
      { state: q.get("state"), code: "auth-code" },
      { fetch: endpoint.fetch, keys: { google: googleIdp.keys } }
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/project/p1`);
    // PKCE: the verifier sent to Google hashes to the challenge sent earlier.
    const sent = endpoint.calls[0].body;
    expect(pkceChallenge(sent.get("code_verifier") ?? "")).toBe(q.get("code_challenge"));
    expect(sent.get("client_secret")).toBe("google-secret");
    expect(sent.get("code")).toBe("auth-code");

    const token = res.cookies.get(SESSION_COOKIE)?.value ?? "";
    expect(await sessionUserFor(token)).toMatchObject({ email: "writer@gmail.com", name: "Ada Writer" });
    // The flow cookie is spent.
    expect(res.cookies.get(OAUTH_COOKIE)?.value).toBe("");
  });

  it("the signed-in web session resolves through getSessionUser", async () => {
    const { location, cookie } = start("/api/auth/oauth/google/start");
    const idToken = await googleIdp.mint({
      sub: "g-7",
      aud: "web-client.apps.googleusercontent.com",
      email: "seven@gmail.com",
      email_verified: true,
      nonce: location.searchParams.get("nonce"),
    });
    const res = await callback(
      "google",
      cookie?.value,
      { state: location.searchParams.get("state"), code: "c" },
      { fetch: tokenEndpoint(() => ({ id_token: idToken })).fetch, keys: { google: googleIdp.keys } }
    );
    const token = res.cookies.get(SESSION_COOKIE)?.value ?? "";
    const req = new NextRequest(`${ORIGIN}/`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(await getSessionUser(req)).toMatchObject({ email: "seven@gmail.com" });
  });

  it("rejects a callback whose state is not the one this browser started", async () => {
    const { cookie } = start("/api/auth/oauth/google/start?next=/x");
    const endpoint = tokenEndpoint(() => ({ id_token: "never" }));
    const res = await callback(
      "google",
      cookie?.value,
      { state: "attacker-state", code: "c" },
      { fetch: endpoint.fetch, keys: { google: googleIdp.keys } }
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=expired&next=%2Fx`);
    expect(endpoint.calls).toHaveLength(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a callback with no flow cookie", async () => {
    const res = await callback("google", undefined, { state: "s", code: "c" }, {});
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=expired`);
  });

  it("rejects a token minted for another nonce", async () => {
    const { location, cookie } = start("/api/auth/oauth/google/start");
    const idToken = await googleIdp.mint({
      sub: "g-9",
      aud: "web-client.apps.googleusercontent.com",
      email: "nine@gmail.com",
      email_verified: true,
      nonce: "some-other-sign-in",
    });
    const res = await callback(
      "google",
      cookie?.value,
      { state: location.searchParams.get("state"), code: "c" },
      { fetch: tokenEndpoint(() => ({ id_token: idToken })).fetch, keys: { google: googleIdp.keys } }
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=failed`);
    expect(await prisma.user.count()).toBe(0);
  });

  it("reports a cancelled consent screen", async () => {
    const { location, cookie } = start("/api/auth/oauth/google/start");
    const res = await callback(
      "google",
      cookie?.value,
      { state: location.searchParams.get("state"), error: "access_denied" },
      {}
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=cancelled`);
  });

  it("reports an unverified email back to the login page", async () => {
    const { location, cookie } = start("/api/auth/oauth/google/start");
    const idToken = await googleIdp.mint({
      sub: "g-u",
      aud: "web-client.apps.googleusercontent.com",
      email: "unverified@example.com",
      email_verified: false,
      nonce: location.searchParams.get("nonce"),
    });
    const res = await callback(
      "google",
      cookie?.value,
      { state: location.searchParams.get("state"), code: "c" },
      { fetch: tokenEndpoint(() => ({ id_token: idToken })).fetch, keys: { google: googleIdp.keys } }
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=unverified_email`);
  });

  it("sends a provider that is not configured back with `unavailable`", () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const { location } = start("/api/auth/oauth/google/start");
    expect(location.toString()).toBe(`${ORIGIN}/login?error=unavailable`);
  });

  it("Apple on the web: form_post, first-time name, refresh token", async () => {
    const { location, cookie } = start("/api/auth/oauth/apple/start");
    const q = location.searchParams;
    expect(location.origin + location.pathname).toBe("https://appleid.apple.com/auth/authorize");
    expect(q.get("client_id")).toBe("app.ciciro.web");
    expect(q.get("response_type")).toBe("code id_token");
    expect(q.get("response_mode")).toBe("form_post");
    expect(q.get("scope")).toBe("name email");
    // Apple returns with a cross-site POST, which only carries SameSite=None.
    expect(cookie).toMatchObject({ sameSite: "none", secure: true });

    const idToken = await appleIdp.mint({
      sub: "001.web",
      aud: "app.ciciro.web",
      email: "x7yq@privaterelay.appleid.com",
      email_verified: "true",
      is_private_email: "true",
      nonce: q.get("nonce"),
    });
    const endpoint = tokenEndpoint(() => ({ refresh_token: "apple-rt", id_token: idToken }));
    const res = await callback(
      "apple",
      cookie?.value,
      {
        state: q.get("state"),
        code: "apple-code",
        idToken,
        user: JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email: "x" }),
      },
      { fetch: endpoint.fetch, keys: { apple: appleIdp.keys } }
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    const user = await sessionUserFor(res.cookies.get(SESSION_COOKIE)?.value ?? "");
    expect(user).toMatchObject({ email: "x7yq@privaterelay.appleid.com", name: "Ada Lovelace" });

    // The code went to Apple with a client secret signed by the team key.
    expect(endpoint.calls[0].url).toBe("https://appleid.apple.com/auth/token");
    expect(endpoint.calls[0].body.get("client_id")).toBe("app.ciciro.web");
    expect(endpoint.calls[0].body.get("client_secret")?.split(".")).toHaveLength(3);
    expect((await prisma.identity.findFirstOrThrow()).refreshToken).toBe("apple-rt");
  });

  it("Apple still signs in when the code exchange fails", async () => {
    const { location, cookie } = start("/api/auth/oauth/apple/start");
    const idToken = await appleIdp.mint({
      sub: "001.noexchange",
      aud: "app.ciciro.web",
      email: "a@icloud.com",
      email_verified: true,
      nonce: location.searchParams.get("nonce"),
    });
    const failing = (async () => Response.json({ error: "invalid_client" }, { status: 400 })) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callback(
      "apple",
      cookie?.value,
      { state: location.searchParams.get("state"), code: "c", idToken },
      { fetch: failing, keys: { apple: appleIdp.keys } }
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect((await prisma.identity.findFirstOrThrow()).refreshToken).toBe("");
  });

  describe("the phone's browser flow and hand-off", () => {
    async function nativeSignIn() {
      const verifier = randomToken();
      const { location, cookie } = start(
        `/api/auth/oauth/google/start?client=native&challenge=${pkceChallenge(verifier)}`
      );
      const idToken = await googleIdp.mint({
        sub: "g-phone",
        aud: "web-client.apps.googleusercontent.com",
        email: "phone@gmail.com",
        email_verified: true,
        nonce: location.searchParams.get("nonce"),
      });
      const res = await callback(
        "google",
        cookie?.value,
        { state: location.searchParams.get("state"), code: "c" },
        { fetch: tokenEndpoint(() => ({ id_token: idToken })).fetch, keys: { google: googleIdp.keys } }
      );
      const back = new URL(res.headers.get("location") ?? "");
      return { res, back, verifier };
    }

    it("returns to the app with a one-time code the verifier redeems", async () => {
      const { res, back, verifier } = await nativeSignIn();
      expect(back.protocol + back.host + back.pathname).toBe("ciciro:oauth");
      // No session is handed out in the URL.
      expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
      const code = back.searchParams.get("code") ?? "";
      await expect(redeemHandoff(code, verifier)).resolves.toMatchObject({ email: "phone@gmail.com" });
      // Single use.
      await expect(redeemHandoff(code, verifier)).rejects.toMatchObject({ status: 401 });
    });

    it("a stolen code is useless without the verifier, and the wrong one burns it", async () => {
      const { back, verifier } = await nativeSignIn();
      const code = back.searchParams.get("code") ?? "";
      await expect(redeemHandoff(code, randomToken())).rejects.toMatchObject({ status: 401 });
      await expect(redeemHandoff(code, verifier)).rejects.toMatchObject({ status: 401 });
    });

    it("an expired code does not redeem", async () => {
      const { back, verifier } = await nativeSignIn();
      await prisma.authHandoff.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(redeemHandoff(back.searchParams.get("code"), verifier)).rejects.toMatchObject({
        status: 401,
      });
    });

    it("refuses to start without a well-formed challenge", () => {
      const { location } = start("/api/auth/oauth/google/start?client=native&challenge=short");
      expect(location.toString()).toBe("ciciro://oauth?error=failed");
    });

    it("sends failures back to the app, not the web login page", async () => {
      const verifier = randomToken();
      const { location, cookie } = start(
        `/api/auth/oauth/google/start?client=native&challenge=${pkceChallenge(verifier)}`
      );
      const res = await callback(
        "google",
        cookie?.value,
        { state: location.searchParams.get("state"), error: "access_denied" },
        {}
      );
      expect(res.headers.get("location")).toBe("ciciro://oauth?error=cancelled");
    });
  });

  describe("the iOS Apple sheet", () => {
    it("signs in with a token carrying the SHA-256 of the app's raw nonce", async () => {
      const rawNonce = randomToken();
      const idToken = await appleIdp.mint({
        sub: "001.ios",
        aud: "app.ciciro.mobile",
        email: "ios@icloud.com",
        email_verified: true,
        nonce: sha256Hex(rawNonce),
      });
      const endpoint = tokenEndpoint(() => ({ refresh_token: "ios-rt" }));
      const user = await signInWithAppleNative(
        { idToken, nonce: rawNonce, authorizationCode: "ios-code", givenName: "Grace", familyName: "Hopper" },
        { fetch: endpoint.fetch, keys: { apple: appleIdp.keys } }
      );
      expect(user).toMatchObject({ email: "ios@icloud.com", name: "Grace Hopper" });
      // Native codes are issued to the bundle ID, with no redirect_uri.
      expect(endpoint.calls[0].body.get("client_id")).toBe("app.ciciro.mobile");
      expect(endpoint.calls[0].body.has("redirect_uri")).toBe(false);
      expect((await prisma.identity.findFirstOrThrow()).refreshToken).toBe("ios-rt");
    });

    it("rejects a replayed token without the raw nonce", async () => {
      const idToken = await appleIdp.mint({
        sub: "001.ios",
        aud: "app.ciciro.mobile",
        email: "ios@icloud.com",
        email_verified: true,
        nonce: sha256Hex("the-real-nonce"),
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        signInWithAppleNative({ idToken, nonce: "a-guess" }, { keys: { apple: appleIdp.keys } })
      ).rejects.toMatchObject({ status: 401 });
      // The hash itself is not the nonce.
      await expect(
        signInWithAppleNative(
          { idToken, nonce: sha256Hex("the-real-nonce") },
          { keys: { apple: appleIdp.keys } }
        )
      ).rejects.toMatchObject({ status: 401 });
    });

    it("rejects a web (Services ID) token on the native path", async () => {
      const rawNonce = randomToken();
      const idToken = await appleIdp.mint({
        sub: "001.ios",
        aud: "app.ciciro.web",
        email: "ios@icloud.com",
        email_verified: true,
        nonce: sha256Hex(rawNonce),
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        signInWithAppleNative({ idToken, nonce: rawNonce }, { keys: { apple: appleIdp.keys } })
      ).rejects.toMatchObject({ status: 401 });
    });

    it("is unavailable without the bundle ID", async () => {
      vi.stubEnv("APPLE_BUNDLE_ID", "");
      await expect(signInWithAppleNative({ idToken: "x", nonce: "y" })).rejects.toMatchObject({
        status: 503,
      });
    });
  });
});
