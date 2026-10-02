import {
  base64Url,
  browserStartUrl,
  bytesToBase64Url,
  joinName,
  NO_SOCIAL_PROVIDERS,
  parseRedirect,
  socialButtons,
  toSocialErrorKey,
} from "../lib/social-auth";

const ALL = { apple: { web: true, native: true }, google: true };

describe("socialButtons", () => {
  it("uses the Apple sheet on iOS and the browser flow on Android", () => {
    expect(socialButtons(ALL, "ios", true)).toEqual(["apple-native", "google"]);
    expect(socialButtons(ALL, "android", false)).toEqual(["apple-browser", "google"]);
  });

  it("shows nothing when the server has nothing configured", () => {
    expect(socialButtons(NO_SOCIAL_PROVIDERS, "ios", true)).toEqual([]);
    expect(socialButtons(NO_SOCIAL_PROVIDERS, "android", true)).toEqual([]);
  });

  it("hides Apple on iOS without the server's bundle ID or the sheet", () => {
    const webOnly = { apple: { web: true, native: false }, google: false };
    expect(socialButtons(webOnly, "ios", true)).toEqual([]);
    expect(socialButtons(ALL, "ios", false)).toEqual(["google"]);
  });
});

describe("parseRedirect", () => {
  it("reads the one-time code", () => {
    expect(parseRedirect("ciciro://oauth?code=abc_-123")).toEqual({
      code: "abc_-123",
      takeover: undefined,
      created: false,
      provider: undefined,
    });
  });

  it("reads a known error and folds anything else into `failed`", () => {
    expect(parseRedirect("ciciro://oauth?error=unverified_email")).toEqual({ error: "unverified_email" });
    expect(parseRedirect("ciciro://oauth?error=weird")).toEqual({ error: "failed" });
    expect(parseRedirect("ciciro://oauth")).toEqual({ error: "failed" });
  });

  it("carries the provider that took over an unverified password account", () => {
    expect(parseRedirect("ciciro://oauth?code=abc&password_removed=google")).toEqual({
      code: "abc",
      takeover: "google",
      created: false,
      provider: undefined,
    });
    expect(parseRedirect("ciciro://oauth?code=abc&password_removed=evil")).toEqual({
      code: "abc",
      takeover: undefined,
      created: false,
      provider: undefined,
    });
  });

  it("carries the new-account flag and provider from a server-fired auth event", () => {
    expect(
      parseRedirect("ciciro://oauth?code=abc&auth_event=account_created&auth_provider=apple")
    ).toEqual({ code: "abc", takeover: undefined, created: true, provider: "apple" });
  });

  it("ignores a code on any other URL", () => {
    expect(parseRedirect("evil://oauth?code=abc")).toEqual({ error: "failed" });
  });
});

describe("helpers", () => {
  it("builds the browser flow's start URL", () => {
    expect(browserStartUrl("https://ciciro.app", "google", "E9Mel-_x")).toBe(
      "https://ciciro.app/api/auth/oauth/google/start?client=native&challenge=E9Mel-_x"
    );
  });

  it("encodes PKCE values as unpadded base64url", () => {
    // RFC 7636 appendix B: SHA-256 of the example verifier, as base64.
    expect(base64Url("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM=")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    expect(bytesToBase64Url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
  });

  it("joins Apple's name parts", () => {
    expect(joinName(" Ada ", "Lovelace")).toBe("Ada Lovelace");
    expect(joinName(null, null)).toBe("");
  });

  it("maps unknown error keys to failed", () => {
    expect(toSocialErrorKey("expired")).toBe("expired");
    expect(toSocialErrorKey(undefined)).toBe("failed");
  });
});
