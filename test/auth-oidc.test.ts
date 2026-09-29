import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  appleClientSecret,
  exchangeCode,
  IdTokenError,
  pkceChallenge,
  sha256Hex,
  verifyIdToken,
} from "@/lib/auth/oidc";
import { fakeAppleSigningKey, fakeIdp, type FakeIdp } from "./helpers/fake-idp";

describe("verifyIdToken", () => {
  let apple: FakeIdp;
  let google: FakeIdp;
  let impostor: FakeIdp;

  beforeAll(async () => {
    apple = await fakeIdp("apple");
    google = await fakeIdp("google");
    // Same kid as Google's, different key: a forged signature.
    impostor = await fakeIdp("google", "google-test-key");
  });

  const googleClaims = {
    sub: "g-123",
    aud: "web-client",
    email: "Writer@Gmail.com",
    email_verified: true,
    name: "Ada Writer",
    nonce: "n-1",
  };

  it("accepts a valid Google token and normalizes its claims", async () => {
    const token = await google.mint(googleClaims);
    await expect(
      verifyIdToken("google", token, { audiences: ["web-client"], nonce: "n-1", keys: google.keys })
    ).resolves.toEqual({
      provider: "google",
      subject: "g-123",
      email: "writer@gmail.com",
      emailVerified: true,
      name: "Ada Writer",
    });
  });

  it("accepts Google's issuer without the scheme", async () => {
    const token = await google.mint({ ...googleClaims, iss: "accounts.google.com" });
    await expect(
      verifyIdToken("google", token, { audiences: ["web-client"], nonce: "n-1", keys: google.keys })
    ).resolves.toMatchObject({ subject: "g-123" });
  });

  it("reads Apple's string booleans and treats relay emails as ordinary", async () => {
    const token = await apple.mint({
      sub: "001234.abcd",
      aud: "app.ciciro.web",
      email: "x7yq@privaterelay.appleid.com",
      email_verified: "true",
      is_private_email: "true",
      nonce: "n-2",
    });
    await expect(
      verifyIdToken("apple", token, { audiences: ["app.ciciro.web"], nonce: "n-2", keys: apple.keys })
    ).resolves.toEqual({
      provider: "apple",
      subject: "001234.abcd",
      email: "x7yq@privaterelay.appleid.com",
      emailVerified: true,
      name: "",
    });
  });

  it("reports an unverified email as unverified", async () => {
    const token = await google.mint({ ...googleClaims, email_verified: false });
    const identity = await verifyIdToken("google", token, {
      audiences: ["web-client"],
      nonce: "n-1",
      keys: google.keys,
    });
    expect(identity.emailVerified).toBe(false);
  });

  it.each([
    ["a wrong audience", { aud: "someone-else" }, {}],
    ["a wrong issuer", { iss: "https://evil.example" }, {}],
    ["a wrong nonce", { nonce: "replayed" }, {}],
    ["a missing nonce", { nonce: undefined }, {}],
    ["no subject", { sub: undefined }, {}],
    ["an expired token", {}, { issuedAt: Math.floor(Date.now() / 1000) - 3600, expiresIn: 600 }],
  ])("rejects %s", async (_label, overrides, options) => {
    const token = await google.mint({ ...googleClaims, ...overrides }, options);
    await expect(
      verifyIdToken("google", token, { audiences: ["web-client"], nonce: "n-1", keys: google.keys })
    ).rejects.toBeInstanceOf(IdTokenError);
  });

  it("rejects a token signed by another key", async () => {
    const token = await impostor.mint(googleClaims);
    await expect(
      verifyIdToken("google", token, { audiences: ["web-client"], nonce: "n-1", keys: google.keys })
    ).rejects.toBeInstanceOf(IdTokenError);
  });

  it("rejects an Apple token presented as Google's", async () => {
    const token = await apple.mint({ ...googleClaims });
    await expect(
      verifyIdToken("google", token, { audiences: ["web-client"], nonce: "n-1", keys: apple.keys })
    ).rejects.toBeInstanceOf(IdTokenError);
  });

  it("refuses to verify without an audience or a nonce", async () => {
    const token = await google.mint(googleClaims);
    await expect(
      verifyIdToken("google", token, { audiences: [""], nonce: "n-1", keys: google.keys })
    ).rejects.toThrow(/no audience/);
    await expect(
      verifyIdToken("google", token, { audiences: ["web-client"], nonce: "", keys: google.keys })
    ).rejects.toThrow(/no nonce/);
  });

  it("drops a malformed email", async () => {
    const token = await google.mint({ ...googleClaims, email: "not-an-email" });
    const identity = await verifyIdToken("google", token, {
      audiences: ["web-client"],
      nonce: "n-1",
      keys: google.keys,
    });
    expect(identity).toMatchObject({ email: null, emailVerified: false });
  });
});

describe("appleClientSecret", () => {
  it("is an ES256 JWT Apple can verify with the team's key", async () => {
    const { pem: privateKey, publicKey } = await fakeAppleSigningKey();
    const now = new Date("2026-09-28T12:00:00Z");
    const secret = await appleClientSecret(
      { servicesId: "app.ciciro.web", bundleId: "", teamId: "TEAM123456", keyId: "KEY1234567", privateKey },
      "app.ciciro.web",
      now
    );
    expect(decodeProtectedHeader(secret)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    const claims = decodeJwt(secret);
    expect(claims).toMatchObject({
      iss: "TEAM123456",
      sub: "app.ciciro.web",
      aud: "https://appleid.apple.com",
      iat: now.getTime() / 1000,
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(300);
    await expect(jwtVerify(secret, publicKey, { currentDate: now })).resolves.toBeTruthy();
  });
});

describe("exchangeCode", () => {
  it("posts the grant and returns the tokens", async () => {
    const fetchStub = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ id_token: "id.tok.en", refresh_token: "r-1", access_token: "a" })
    );
    const out = await exchangeCode(
      "google",
      {
        code: "c-1",
        clientId: "web-client",
        clientSecret: "shh",
        redirectUri: "https://ciciro.app/api/auth/oauth/google/callback",
        codeVerifier: "v-1",
      },
      fetchStub as unknown as typeof fetch
    );
    expect(out).toEqual({ idToken: "id.tok.en", refreshToken: "r-1" });
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "c-1",
      client_id: "web-client",
      client_secret: "shh",
      redirect_uri: "https://ciciro.app/api/auth/oauth/google/callback",
      code_verifier: "v-1",
    });
  });

  it("throws with the provider's error", async () => {
    const fetchStub = async () => Response.json({ error: "invalid_grant" }, { status: 400 });
    await expect(
      exchangeCode("apple", { code: "c", clientId: "x", clientSecret: "y" }, fetchStub as typeof fetch)
    ).rejects.toThrow(/invalid_grant/);
  });
});

describe("hashes", () => {
  it("matches RFC 7636's S256 example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("hex-encodes SHA-256 like expo-crypto", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
