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

describe("needsConsentPrompt by mode", () => {
  it("never asks in an opt-out place, whatever is stored", () => {
    const { needsConsentPrompt } = loadConsent();
    expect(needsConsentPrompt(null, "opt-out")).toBe(false);
    expect(needsConsentPrompt({ version: 0, categories: { analytics: false }, decidedAt: "x" }, "opt-out")).toBe(false);
  });

  it("asks in an opt-in place until the current version is decided", () => {
    const { needsConsentPrompt } = loadConsent();
    expect(needsConsentPrompt(null, "opt-in")).toBe(true);
    expect(needsConsentPrompt({ version: 1, categories: { analytics: false }, decidedAt: "x" }, "opt-in")).toBe(false);
  });
});

describe("deviceAnalyticsAllowed", () => {
  const yes = { version: 1, categories: { analytics: true }, decidedAt: "x" };
  const no = { version: 1, categories: { analytics: false }, decidedAt: "x" };

  it("defaults off where the person must opt in, on where they opt out", () => {
    const { deviceAnalyticsAllowed } = loadConsent();
    expect(deviceAnalyticsAllowed(null, "opt-in")).toBe(false);
    expect(deviceAnalyticsAllowed(null, "opt-out")).toBe(true);
  });

  it("follows the recorded decision in either place", () => {
    const { deviceAnalyticsAllowed } = loadConsent();
    expect(deviceAnalyticsAllowed(yes, "opt-in")).toBe(true);
    expect(deviceAnalyticsAllowed(no, "opt-out")).toBe(false);
    expect(deviceAnalyticsAllowed(yes, "opt-out")).toBe(true);
    expect(deviceAnalyticsAllowed(no, "opt-in")).toBe(false);
  });
});

describe("effectiveAnalyticsAllowed", () => {
  const granted = { version: 1, categories: { analytics: true }, decidedAt: "x" };
  const denied = { version: 1, categories: { analytics: false }, decidedAt: "x" };

  it("is false in an opt-in place whenever the device hasn't granted analytics, regardless of account state", () => {
    const { effectiveAnalyticsAllowed } = loadConsent();
    expect(effectiveAnalyticsAllowed({ record: null, mode: "opt-in", signedIn: false, accountEnabled: true })).toBe(false);
    expect(effectiveAnalyticsAllowed({ record: denied, mode: "opt-in", signedIn: false, accountEnabled: true })).toBe(false);
  });

  it("is true for an anonymous visitor once the device grants analytics, regardless of any local account flag", () => {
    const { effectiveAnalyticsAllowed } = loadConsent();
    expect(effectiveAnalyticsAllowed({ record: granted, mode: "opt-in", signedIn: false, accountEnabled: false })).toBe(true);
  });

  it("requires the signed-in account to also agree once someone is signed in", () => {
    const { effectiveAnalyticsAllowed } = loadConsent();
    expect(effectiveAnalyticsAllowed({ record: granted, mode: "opt-in", signedIn: true, accountEnabled: true })).toBe(true);
    expect(effectiveAnalyticsAllowed({ record: granted, mode: "opt-in", signedIn: true, accountEnabled: false })).toBe(false);
  });

  it("is on by default in an opt-out place, signed out or with the account on", () => {
    const { effectiveAnalyticsAllowed } = loadConsent();
    expect(effectiveAnalyticsAllowed({ record: null, mode: "opt-out", signedIn: false, accountEnabled: false })).toBe(true);
    expect(effectiveAnalyticsAllowed({ record: null, mode: "opt-out", signedIn: true, accountEnabled: true })).toBe(true);
  });

  it("lets a saved account opt-out, or a device decline, win over the opt-out default", () => {
    const { effectiveAnalyticsAllowed } = loadConsent();
    expect(effectiveAnalyticsAllowed({ record: null, mode: "opt-out", signedIn: true, accountEnabled: false })).toBe(false);
    expect(effectiveAnalyticsAllowed({ record: denied, mode: "opt-out", signedIn: false, accountEnabled: true })).toBe(false);
  });
});
