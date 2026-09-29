import {
  PUSH_REFRESH_MS,
  parsePushRecord,
  requestPushRegistrationSync,
  subscribePushRegistrationSync,
  syncPushRegistration,
  type PushPermission,
  type PushRegistrationDeps,
  type PushRegistrationRecord,
} from "../lib/push-registration";

const TOKEN = "ExponentPushToken[phone]";

function deps(
  permission: PushPermission,
  record: PushRegistrationRecord | null = null,
  overrides: Partial<PushRegistrationDeps> = {}
) {
  let saved = record;
  const d = {
    platform: "ios" as const,
    getPermission: jest.fn(async () => permission),
    getToken: jest.fn(async () => TOKEN),
    register: jest.fn(async () => ({ ok: true })),
    unregister: jest.fn(async () => ({ ok: true })),
    load: jest.fn(() => saved),
    save: jest.fn((next: PushRegistrationRecord | null) => {
      saved = next;
    }),
    ...overrides,
  };
  return { d, saved: () => saved };
}

describe("syncPushRegistration", () => {
  it("registers once notifications are allowed, and remembers it", async () => {
    const { d, saved } = deps("granted");
    await expect(syncPushRegistration("u1", d, { now: 1000 })).resolves.toBe("registered");
    expect(d.register).toHaveBeenCalledWith({ token: TOKEN, platform: "ios" });
    expect(saved()).toEqual({ userId: "u1", token: TOKEN, at: 1000 });
  });

  it("does not register again on every launch", async () => {
    const { d } = deps("granted", { userId: "u1", token: TOKEN, at: 1000 });
    await expect(syncPushRegistration("u1", d, { now: 2000 })).resolves.toBe("unchanged");
    expect(d.register).not.toHaveBeenCalled();
  });

  it("refreshes daily, for a new token, for another account, or when forced", async () => {
    for (const [record, options] of [
      [{ userId: "u1", token: TOKEN, at: 0 }, { now: PUSH_REFRESH_MS }],
      [{ userId: "u1", token: "ExponentPushToken[old]", at: 1000 }, { now: 2000 }],
      [{ userId: "u2", token: TOKEN, at: 1000 }, { now: 2000 }],
      [{ userId: "u1", token: TOKEN, at: 1000 }, { now: 2000, force: true }],
    ] as const) {
      const { d } = deps("granted", record);
      await expect(syncPushRegistration("u1", d, options)).resolves.toBe("registered");
    }
  });

  it("never asks for permission itself", async () => {
    const { d } = deps("undetermined");
    await expect(syncPushRegistration("u1", d)).resolves.toBe("skipped");
    expect(d.getToken).not.toHaveBeenCalled();
    expect(d.register).not.toHaveBeenCalled();
  });

  it("unregisters when the author turns notifications off", async () => {
    const { d, saved } = deps("denied", { userId: "u1", token: TOKEN, at: 1000 });
    await expect(syncPushRegistration("u1", d)).resolves.toBe("unregistered");
    expect(d.unregister).toHaveBeenCalledWith({ token: TOKEN });
    expect(saved()).toBeNull();
  });

  it("keeps the record to retry when unregistering fails", async () => {
    const { d, saved } = deps("denied", { userId: "u1", token: TOKEN, at: 1000 }, {
      unregister: jest.fn(async () => {
        throw new Error("offline");
      }),
    });
    await expect(syncPushRegistration("u1", d)).resolves.toBe("skipped");
    expect(saved()).not.toBeNull();
  });

  it("forgets another account's record without calling the server for it", async () => {
    const { d, saved } = deps("denied", { userId: "u2", token: TOKEN, at: 1000 });
    await expect(syncPushRegistration("u1", d)).resolves.toBe("unregistered");
    expect(d.unregister).not.toHaveBeenCalled();
    expect(saved()).toBeNull();
  });

  it("skips quietly when there is no token or the server is unreachable", async () => {
    const noToken = deps("granted", null, {
      getToken: jest.fn(async () => {
        throw new Error("no APNs");
      }),
    });
    await expect(syncPushRegistration("u1", noToken.d)).resolves.toBe("skipped");
    const offline = deps("granted", null, {
      register: jest.fn(async () => {
        throw new Error("offline");
      }),
    });
    await expect(syncPushRegistration("u1", offline.d)).resolves.toBe("skipped");
    expect(offline.saved()).toBeNull();
  });
});

describe("push registration helpers", () => {
  it("parses only a well-formed record", () => {
    expect(parsePushRecord(JSON.stringify({ userId: "u1", token: TOKEN, at: 5 }))).toEqual({
      userId: "u1",
      token: TOKEN,
      at: 5,
    });
    expect(parsePushRecord(undefined)).toBeNull();
    expect(parsePushRecord("{")).toBeNull();
    expect(parsePushRecord(JSON.stringify({ userId: "u1" }))).toBeNull();
  });

  it("wakes the mounted sync after a permission prompt", () => {
    const listener = jest.fn();
    const unsubscribe = subscribePushRegistrationSync(listener);
    requestPushRegistrationSync();
    unsubscribe();
    requestPushRegistrationSync();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
