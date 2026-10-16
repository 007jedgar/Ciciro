const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));
jest.mock("../lib/api", () => ({ api: jest.fn() }));

type Store = typeof import("../lib/consent-region-store");

function loadStore(): Store {
  let mod!: Store;
  jest.isolateModules(() => {
    mod = require("../lib/consent-region-store");
  });
  return mod;
}

describe("consent region store", () => {
  beforeEach(() => {
    mockDisk.clear();
    jest.useRealTimers();
  });

  it("is unknown, and so asks, before any lookup", () => {
    const store = loadStore();
    expect(store.getRegionState().geo).toBeNull();
    expect(store.getRegionState().settled).toBe(false);
    expect(store.getConsentMode()).toBe("opt-in");
  });

  it("reads a successful lookup, normalised, and caches it across launches", async () => {
    const first = loadStore();
    await first.refreshRegion({ fetchGeo: async () => ({ country: "us", region: "tx" }) });
    expect(first.getConsentMode()).toBe("opt-out");
    expect(first.getRegionState()).toEqual({ geo: { country: "US", region: "TX" }, settled: true });

    const relaunch = loadStore();
    expect(relaunch.getConsentMode()).toBe("opt-out");
    expect(relaunch.getRegionState().settled).toBe(false);
  });

  it("asks for California", async () => {
    const store = loadStore();
    await store.refreshRegion({ fetchGeo: async () => ({ country: "US", region: "CA" }) });
    expect(store.getConsentMode()).toBe("opt-in");
  });

  it("keeps the cached place and still settles when the lookup fails", async () => {
    const first = loadStore();
    await first.refreshRegion({ fetchGeo: async () => ({ country: "US", region: "TX" }) });
    const relaunch = loadStore();
    await relaunch.refreshRegion({
      fetchGeo: async () => {
        throw new Error("offline");
      },
    });
    expect(relaunch.getRegionState().settled).toBe(true);
    expect(relaunch.getConsentMode()).toBe("opt-out");
  });

  it("asks when a failed lookup leaves nothing cached", async () => {
    const store = loadStore();
    await store.refreshRegion({
      fetchGeo: async () => {
        throw new Error("offline");
      },
    });
    expect(store.getRegionState()).toEqual({ geo: null, settled: true });
    expect(store.getConsentMode()).toBe("opt-in");
  });

  it("stops trusting a cached place after a week", async () => {
    const store = loadStore();
    const start = 1_000_000;
    await store.refreshRegion({ fetchGeo: async () => ({ country: "US", region: "TX" }) }, () => start);
    expect(store.getConsentMode(start + 1000)).toBe("opt-out");
    expect(store.getConsentMode(start + 8 * 24 * 60 * 60 * 1000)).toBe("opt-in");
  });

  it("ignores a garbled cache", () => {
    mockDisk.set("consent-region", "{nope");
    expect(loadStore().getConsentMode()).toBe("opt-in");
    mockDisk.set("consent-region", JSON.stringify({ geo: "US", fetchedAt: Date.now() }));
    expect(loadStore().getConsentMode()).toBe("opt-in");
  });

  it("runs one lookup at a time and re-checks only when stale", async () => {
    const store = loadStore();
    const fetchGeo = jest.fn(async () => ({ country: "US", region: "TX" }));
    await Promise.all([store.refreshRegion({ fetchGeo }), store.refreshRegion({ fetchGeo })]);
    expect(fetchGeo).toHaveBeenCalledTimes(1);

    await store.refreshRegionIfStale({ fetchGeo }, () => Date.now() + 60_000);
    expect(fetchGeo).toHaveBeenCalledTimes(1);
    await store.refreshRegionIfStale({ fetchGeo }, () => Date.now() + store.REGION_REFRESH_MS + 1);
    expect(fetchGeo).toHaveBeenCalledTimes(2);
  });

  it("lets a one-time decision wait for the lookup in flight", async () => {
    const store = loadStore();
    await expect(store.regionLookup()).resolves.toBeUndefined();
    let answer: (geo: { country: string; region: string }) => void = () => {};
    void store.refreshRegion({ fetchGeo: () => new Promise((resolve) => (answer = resolve)) });
    const waited = store.regionLookup().then(() => store.getConsentMode());
    answer({ country: "US", region: "TX" });
    await expect(waited).resolves.toBe("opt-out");
  });

  it("stops waiting for a lookup that never answers", async () => {
    jest.useFakeTimers();
    const store = loadStore();
    void store.refreshRegion({ fetchGeo: () => new Promise(() => {}) });
    expect(store.getRegionState().settled).toBe(false);
    jest.advanceTimersByTime(store.REGION_PATIENCE_MS + 1);
    expect(store.getRegionState().settled).toBe(true);
    expect(store.getConsentMode()).toBe("opt-in");
  });
});
