import {
  compareVersions,
  isValidVersion,
  platformPolicyFrom,
  requiresForceUpdate,
} from "../lib/version-policy";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("treats a missing part as 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBe(-1);
  });
});

describe("isValidVersion", () => {
  it("accepts 1-3 numeric parts", () => {
    expect(isValidVersion("1")).toBe(true);
    expect(isValidVersion("1.2")).toBe(true);
    expect(isValidVersion("1.2.3")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidVersion("1.2.3.4")).toBe(false);
    expect(isValidVersion("v1.2.3")).toBe(false);
    expect(isValidVersion("1.2.x")).toBe(false);
    expect(isValidVersion("")).toBe(false);
    expect(isValidVersion(null)).toBe(false);
    expect(isValidVersion(undefined)).toBe(false);
    expect(isValidVersion(123)).toBe(false);
  });
});

describe("platformPolicyFrom", () => {
  it("reads the named platform's fields, dropping malformed versions", () => {
    expect(platformPolicyFrom({ ios: { minimumVersion: "2.0.0", latestVersion: "2.1.0" } }, "ios")).toEqual({
      minimumVersion: "2.0.0",
      latestVersion: "2.1.0",
    });
    expect(platformPolicyFrom({ ios: { minimumVersion: "not-a-version" } }, "ios")).toEqual({
      minimumVersion: null,
      latestVersion: null,
    });
  });

  it("returns null for a missing platform key or a non-object response", () => {
    expect(platformPolicyFrom({ ios: {} }, "android")).toBeNull();
    expect(platformPolicyFrom(null, "ios")).toBeNull();
    expect(platformPolicyFrom("garbage", "ios")).toBeNull();
    expect(platformPolicyFrom({ ios: "garbage" }, "ios")).toBeNull();
  });
});

describe("requiresForceUpdate", () => {
  it("blocks when the installed version is below the minimum", () => {
    expect(requiresForceUpdate("2.0.0", { minimumVersion: "2.1.0" })).toBe(true);
  });

  it("does not block when equal to or above the minimum", () => {
    expect(requiresForceUpdate("2.1.0", { minimumVersion: "2.1.0" })).toBe(false);
    expect(requiresForceUpdate("2.2.0", { minimumVersion: "2.1.0" })).toBe(false);
  });

  it("fails open when the minimum is missing or unset (0.0.0)", () => {
    expect(requiresForceUpdate("0.1.0", { minimumVersion: undefined })).toBe(false);
    expect(requiresForceUpdate("0.1.0", { minimumVersion: null })).toBe(false);
    expect(requiresForceUpdate("0.1.0", { minimumVersion: "0.0.0" })).toBe(false);
    expect(requiresForceUpdate("0.1.0", {})).toBe(false);
  });

  it("fails open on a malformed minimum or a malformed installed version", () => {
    expect(requiresForceUpdate("2.0.0", { minimumVersion: "not-a-version" })).toBe(false);
    expect(requiresForceUpdate("not-a-version", { minimumVersion: "2.1.0" })).toBe(false);
    expect(requiresForceUpdate(null, { minimumVersion: "2.1.0" })).toBe(false);
    expect(requiresForceUpdate(undefined, { minimumVersion: "2.1.0" })).toBe(false);
  });

  it("fails open when there is no policy at all (offline with no cache)", () => {
    expect(requiresForceUpdate("2.0.0", null)).toBe(false);
    expect(requiresForceUpdate("2.0.0", undefined)).toBe(false);
  });
});
