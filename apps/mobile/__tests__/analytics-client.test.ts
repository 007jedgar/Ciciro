type Call = { method: string };

function fakeAdapterFactory() {
  const calls: Call[] = [];
  const adapter = {
    identify: () => calls.push({ method: "identify" }),
    reset: () => calls.push({ method: "reset" }),
    track: () => calls.push({ method: "track" }),
    screen: () => calls.push({ method: "screen" }),
    registerSuperProperties: () => calls.push({ method: "registerSuperProperties" }),
    setOptedOut: (optedOut: boolean) => calls.push({ method: optedOut ? "optOut" : "optIn" }),
    deleteUser: () => calls.push({ method: "deleteUser" }),
  };
  return { adapter, calls };
}

let adapterOut: ReturnType<typeof fakeAdapterFactory>;

function loadAnalyticsClient(apiKey: string | undefined, createAdapter: () => typeof adapterOut.adapter) {
  if (apiKey === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  else process.env.EXPO_PUBLIC_POSTHOG_KEY = apiKey;
  jest.doMock("../lib/analytics-posthog-native", () => ({
    createPostHogNativeAdapter: createAdapter,
  }));
  let mod!: typeof import("../lib/analytics-client");
  jest.isolateModules(() => {
    mod = require("../lib/analytics-client");
  });
  return mod;
}

afterEach(() => {
  jest.resetModules();
  jest.unmock("../lib/analytics-posthog-native");
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
});

describe("getAnalytics before any consent", () => {
  it("never constructs the real adapter and every call is a silent no-op", () => {
    adapterOut = fakeAdapterFactory();
    const create = jest.fn(() => adapterOut.adapter);
    const { getAnalytics } = loadAnalyticsClient("phc_test", create);
    getAnalytics().track("chat_message_sent", {});
    getAnalytics().identify("u1");
    expect(create).not.toHaveBeenCalled();
    expect(adapterOut.calls).toEqual([]);
  });
});

describe("setAnalyticsConsent", () => {
  it("grant builds the real adapter (once) and opts it in", () => {
    adapterOut = fakeAdapterFactory();
    const create = jest.fn(() => adapterOut.adapter);
    const { getAnalytics, setAnalyticsConsent } = loadAnalyticsClient("phc_test", create);

    setAnalyticsConsent(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(adapterOut.calls).toEqual([{ method: "registerSuperProperties" }, { method: "optIn" }]);

    adapterOut.calls.length = 0;
    getAnalytics().track("chat_message_sent", {});
    expect(create).toHaveBeenCalledTimes(1); // no rebuild on later getAnalytics() calls
    expect(adapterOut.calls).toEqual([{ method: "track" }]);
  });

  it("withdraws in the required order - optOut before reset - without tearing the adapter down", () => {
    adapterOut = fakeAdapterFactory();
    const create = jest.fn(() => adapterOut.adapter);
    const { getAnalytics, setAnalyticsConsent } = loadAnalyticsClient("phc_test", create);

    setAnalyticsConsent(true);
    adapterOut.calls.length = 0;

    setAnalyticsConsent(false);
    expect(adapterOut.calls).toEqual([{ method: "optOut" }, { method: "reset" }]);
    expect(create).toHaveBeenCalledTimes(1); // no rebuild

    adapterOut.calls.length = 0;
    getAnalytics().track("chat_message_sent", {}); // getAnalytics() hands back the no-op while withdrawn, even though the real adapter still exists underneath
    expect(adapterOut.calls).toEqual([]);
  });

  it("re-grants the same instance after a withdrawal in the same session, no app restart needed", () => {
    adapterOut = fakeAdapterFactory();
    const create = jest.fn(() => adapterOut.adapter);
    const { setAnalyticsConsent } = loadAnalyticsClient("phc_test", create);

    setAnalyticsConsent(true);
    setAnalyticsConsent(false);
    adapterOut.calls.length = 0;

    setAnalyticsConsent(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(adapterOut.calls).toEqual([{ method: "optIn" }]);
  });

  it("builds the client opted out, never opting in, while the account's own setting is off", () => {
    adapterOut = fakeAdapterFactory();
    const create = jest.fn(() => adapterOut.adapter);
    const { getAnalytics, setAnalyticsConsent } = loadAnalyticsClient("phc_test", create);

    setAnalyticsConsent(true, false);
    expect(adapterOut.calls).toEqual([{ method: "registerSuperProperties" }, { method: "optOut" }]);

    adapterOut.calls.length = 0;
    getAnalytics().identify("u1");
    getAnalytics().setOptedOut(false);
    expect(adapterOut.calls).toEqual([{ method: "identify" }, { method: "optIn" }]);
  });

  it("is a no-op when the flag does not actually change", () => {
    adapterOut = fakeAdapterFactory();
    const create = jest.fn(() => adapterOut.adapter);
    const { setAnalyticsConsent } = loadAnalyticsClient("phc_test", create);
    setAnalyticsConsent(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("sweepLegacyAnalyticsIdentity", () => {
  it("resets a pre-existing identity and leaves it opted out, without ever opting in", () => {
    adapterOut = fakeAdapterFactory();
    const create = jest.fn(() => adapterOut.adapter);
    const { sweepLegacyAnalyticsIdentity } = loadAnalyticsClient("phc_test", create);

    sweepLegacyAnalyticsIdentity();
    expect(create).toHaveBeenCalledTimes(1);
    expect(adapterOut.calls).toEqual([
      { method: "registerSuperProperties" },
      { method: "optOut" },
      { method: "reset" },
    ]);
  });

  it("does nothing harmful with no API key configured (noop adapter)", () => {
    const create = jest.fn();
    const { sweepLegacyAnalyticsIdentity } = loadAnalyticsClient(undefined, create);
    expect(() => sweepLegacyAnalyticsIdentity()).not.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
