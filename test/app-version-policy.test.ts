import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getVersionPolicy", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MOBILE_MIN_VERSION_IOS;
    delete process.env.MOBILE_MIN_VERSION_ANDROID;
    delete process.env.MOBILE_LATEST_VERSION_IOS;
    delete process.env.MOBILE_LATEST_VERSION_ANDROID;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("defaults to no forced update on either platform", async () => {
    const { getVersionPolicy } = await import("@/lib/app-version-policy");
    expect(getVersionPolicy()).toEqual({
      ios: { minimumVersion: "0.0.0" },
      android: { minimumVersion: "0.0.0" },
    });
  });

  it("resolves a configured minimum per platform", async () => {
    process.env.MOBILE_MIN_VERSION_IOS = "2.3.0";
    process.env.MOBILE_MIN_VERSION_ANDROID = "2.2.0";
    const { getVersionPolicy } = await import("@/lib/app-version-policy");
    expect(getVersionPolicy()).toEqual({
      ios: { minimumVersion: "2.3.0" },
      android: { minimumVersion: "2.2.0" },
    });
  });

  it("includes an optional latest version only when set", async () => {
    process.env.MOBILE_LATEST_VERSION_IOS = "2.4.0";
    const { getVersionPolicy } = await import("@/lib/app-version-policy");
    const policy = getVersionPolicy();
    expect(policy.ios).toEqual({ minimumVersion: "0.0.0", latestVersion: "2.4.0" });
    expect(policy.android).toEqual({ minimumVersion: "0.0.0" });
  });

  it("ignores a blank override and falls back to the default", async () => {
    process.env.MOBILE_MIN_VERSION_IOS = "   ";
    const { getVersionPolicy } = await import("@/lib/app-version-policy");
    expect(getVersionPolicy().ios).toEqual({ minimumVersion: "0.0.0" });
  });
});
