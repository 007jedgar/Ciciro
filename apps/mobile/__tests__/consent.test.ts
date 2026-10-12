const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));

function loadConsent(): typeof import("../lib/consent") {
  let mod!: typeof import("../lib/consent");
  jest.isolateModules(() => {
    mod = require("../lib/consent");
  });
  return mod;
}

describe("needsConsentPrompt", () => {
  it("asks again for no record, or a record from an older version", () => {
    const { needsConsentPrompt, CONSENT_VERSION } = loadConsent();
    expect(needsConsentPrompt(null)).toBe(true);
    expect(needsConsentPrompt({ version: CONSENT_VERSION - 1, categories: { analytics: true }, decidedAt: "x" })).toBe(
      true
    );
    expect(needsConsentPrompt({ version: CONSENT_VERSION, categories: { analytics: false }, decidedAt: "x" })).toBe(
      false
    );
  });
});

describe("decideConsent / getConsent", () => {
  beforeEach(() => mockDisk.clear());

  it("starts undecided and survives an app restart once decided", () => {
    const first = loadConsent();
    expect(first.getConsent()).toBeNull();
    first.decideConsent({ analytics: true }, () => 1000);
    const reloaded = loadConsent();
    expect(reloaded.getConsent()).toEqual({
      version: reloaded.CONSENT_VERSION,
      categories: { analytics: true },
      decidedAt: new Date(1000).toISOString(),
    });
  });

  it("notifies subscribers on every decision", () => {
    const { decideConsent, useConsent } = loadConsent();
    expect(typeof useConsent).toBe("function");
    const record = decideConsent({ analytics: true }, () => 2000);
    expect(record).toEqual({
      version: expect.any(Number),
      categories: { analytics: true },
      decidedAt: new Date(2000).toISOString(),
    });
  });

  it("rejects a non-boolean analytics value rather than treating it as granted", () => {
    const { decideConsent } = loadConsent();
    // Only a literal `true` counts as granted - anything else (including a
    // truthy non-boolean, which should never happen through the typed
    // ConsentCategories API but is cheap to guard) is treated as "no".
    const record = decideConsent({ analytics: 1 as unknown as boolean });
    expect(record.categories.analytics).toBe(false);
  });

  it("ignores a malformed stored record and treats it as undecided", () => {
    mockDisk.set("privacy-consent", "{not json");
    expect(loadConsent().getConsent()).toBeNull();
  });

  it("treats a stored non-boolean analytics value as not granted", () => {
    mockDisk.set(
      "privacy-consent",
      JSON.stringify({ version: 1, categories: { analytics: "yes" }, decidedAt: "2026-01-01T00:00:00.000Z" })
    );
    expect(loadConsent().getConsent()?.categories.analytics).toBe(false);
  });
});

describe("effectiveAnalyticsAllowed", () => {
  it("is false whenever the device hasn't granted analytics, regardless of account state", () => {
    const { effectiveAnalyticsAllowed } = loadConsent();
    expect(effectiveAnalyticsAllowed({ record: null, signedIn: false, accountEnabled: true })).toBe(false);
    expect(
      effectiveAnalyticsAllowed({
        record: { version: 1, categories: { analytics: false }, decidedAt: "x" },
        signedIn: false,
        accountEnabled: true,
      })
    ).toBe(false);
  });

  it("is true for an anonymous visitor once the device grants analytics, regardless of any local account flag", () => {
    const { effectiveAnalyticsAllowed } = loadConsent();
    const granted = { version: 1, categories: { analytics: true }, decidedAt: "x" };
    expect(effectiveAnalyticsAllowed({ record: granted, signedIn: false, accountEnabled: false })).toBe(true);
  });

  it("requires the signed-in account to also agree once someone is signed in", () => {
    const { effectiveAnalyticsAllowed } = loadConsent();
    const granted = { version: 1, categories: { analytics: true }, decidedAt: "x" };
    expect(effectiveAnalyticsAllowed({ record: granted, signedIn: true, accountEnabled: true })).toBe(true);
    expect(effectiveAnalyticsAllowed({ record: granted, signedIn: true, accountEnabled: false })).toBe(false);
  });
});
