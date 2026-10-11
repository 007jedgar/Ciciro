const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));

import {
  checkForceUpdate,
  createForceUpdatePoller,
  FOREGROUND_CHECK_INTERVAL_MS,
  type VersionPolicyClient,
} from "../lib/force-update";

function client(policy: unknown, overrides: Partial<VersionPolicyClient> = {}): VersionPolicyClient {
  return { fetchPolicy: jest.fn(async () => policy), ...overrides };
}

beforeEach(() => {
  mockDisk.clear();
});

describe("checkForceUpdate", () => {
  it("does not block when installed meets the minimum", async () => {
    const c = client({ ios: { minimumVersion: "2.0.0" } });
    await expect(checkForceUpdate("2.0.0", "ios", c)).resolves.toBe(false);
  });

  it("blocks when installed is below the minimum", async () => {
    const c = client({ ios: { minimumVersion: "2.1.0" } });
    await expect(checkForceUpdate("2.0.0", "ios", c)).resolves.toBe(true);
  });

  it("reads the platform-specific minimum", async () => {
    const c = client({ ios: { minimumVersion: "1.0.0" }, android: { minimumVersion: "9.0.0" } });
    await expect(checkForceUpdate("1.0.0", "ios", c)).resolves.toBe(false);
    await expect(checkForceUpdate("1.0.0", "android", c)).resolves.toBe(true);
  });

  it("fails open on a malformed response", async () => {
    const c = client("not an object");
    await expect(checkForceUpdate("1.0.0", "ios", c)).resolves.toBe(false);
  });

  it("fails open when the installed version is unreadable", async () => {
    const c = client({ ios: { minimumVersion: "9.0.0" } });
    await expect(checkForceUpdate(null, "ios", c)).resolves.toBe(false);
  });

  it("falls back to the cached policy on a network failure", async () => {
    const good = client({ ios: { minimumVersion: "5.0.0" } });
    await checkForceUpdate("1.0.0", "ios", good); // primes the cache

    const offline = client(null, { fetchPolicy: jest.fn(async () => { throw new Error("offline"); }) });
    await expect(checkForceUpdate("1.0.0", "ios", offline)).resolves.toBe(true);
  });

  it("fails open on a network failure with no cache", async () => {
    const offline = client(null, { fetchPolicy: jest.fn(async () => { throw new Error("offline"); }) });
    await expect(checkForceUpdate("1.0.0", "ios", offline)).resolves.toBe(false);
  });
});

describe("createForceUpdatePoller", () => {
  it("checks immediately on the first call", async () => {
    const c = client({ ios: { minimumVersion: "2.1.0" } });
    const poll = createForceUpdatePoller(c, "ios", "2.0.0");
    await expect(poll(0)).resolves.toBe(true);
    expect(c.fetchPolicy).toHaveBeenCalledTimes(1);
  });

  it("throttles re-checks to at most once per interval, returning the last decision", async () => {
    const c = client({ ios: { minimumVersion: "2.1.0" } });
    const poll = createForceUpdatePoller(c, "ios", "2.0.0");
    await poll(0);
    await expect(poll(FOREGROUND_CHECK_INTERVAL_MS - 1)).resolves.toBe(true);
    expect(c.fetchPolicy).toHaveBeenCalledTimes(1);
    await expect(poll(FOREGROUND_CHECK_INTERVAL_MS)).resolves.toBe(true);
    expect(c.fetchPolicy).toHaveBeenCalledTimes(2);
  });
});
