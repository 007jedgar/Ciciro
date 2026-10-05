const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));

const mockHaptics = {
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
};
jest.mock("expo-haptics", () => ({
  ...mockHaptics,
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

function load(): typeof import("../lib/haptics") {
  let mod!: typeof import("../lib/haptics");
  jest.isolateModules(() => {
    mod = require("../lib/haptics");
  });
  return mod;
}

const totalCalls = () =>
  mockHaptics.impactAsync.mock.calls.length +
  mockHaptics.selectionAsync.mock.calls.length +
  mockHaptics.notificationAsync.mock.calls.length;

beforeEach(() => {
  mockDisk.clear();
  jest.clearAllMocks();
});

describe("haptics switch", () => {
  it("defaults on and survives an app restart once turned off", () => {
    expect(load().getHapticsEnabled()).toBe(true);
    load().setHapticsEnabled(false);
    expect(load().getHapticsEnabled()).toBe(false);
    load().setHapticsEnabled(true);
    expect(load().getHapticsEnabled()).toBe(true);
  });

  it("plays each kind of haptic while on", () => {
    const h = load();
    h.tap();
    h.impact("medium");
    h.select();
    h.success();
    h.warning();
    h.error();
    expect(mockHaptics.impactAsync).toHaveBeenCalledWith("light");
    expect(mockHaptics.impactAsync).toHaveBeenCalledWith("medium");
    expect(mockHaptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(mockHaptics.notificationAsync.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "success",
      "warning",
      "error",
    ]);
  });

  it("makes no native calls at all while off", () => {
    const h = load();
    h.setHapticsEnabled(false);
    h.tap();
    h.impact("heavy");
    h.select();
    h.success();
    h.warning();
    h.error();
    h.writingTick(1_000_000);
    h.withTap(jest.fn())();
    h.createWritingTicker(() => 5_000_000).feed("A whole sentence. ");
    expect(totalCalls()).toBe(0);
  });

  it("a press handler still runs while off, and the switch taps nothing on its way out", () => {
    const h = load();
    const press = jest.fn();
    h.setHapticsEnabled(false);
    h.withTap(press)();
    expect(press).toHaveBeenCalledTimes(1);

    h.setHapticsEnabled(true);
    h.withTap(h.setHapticsEnabled)(false);
    expect(totalCalls()).toBe(0);
  });

  it("swallows a rejected native call", async () => {
    mockHaptics.impactAsync.mockRejectedValueOnce(new Error("no engine"));
    expect(() => load().tap()).not.toThrow();
    await Promise.resolve();
  });
});

describe("writing tick", () => {
  it("is rate limited to one tick per interval", () => {
    const h = load();
    h.writingTick(1_000);
    h.writingTick(1_100);
    h.writingTick(1_000 + h.WRITING_TICK_MIN_INTERVAL_MS - 1);
    expect(mockHaptics.impactAsync).toHaveBeenCalledTimes(1);
    h.writingTick(1_000 + h.WRITING_TICK_MIN_INTERVAL_MS);
    expect(mockHaptics.impactAsync).toHaveBeenCalledTimes(2);
    expect(mockHaptics.impactAsync).toHaveBeenCalledWith("soft");
  });

  it("ticks once per finished sentence, not per token", () => {
    const h = load();
    let now = 0;
    const ticker = h.createWritingTicker(() => now);
    for (const token of ["The ", "rain ", "fell", " softly", ""]) {
      now += 50;
      ticker.feed(token);
    }
    expect(mockHaptics.impactAsync).not.toHaveBeenCalled();
    now += 50;
    ticker.feed(". ");
    expect(mockHaptics.impactAsync).toHaveBeenCalledTimes(1);
    now += 1_000;
    ticker.feed("Then");
    ticker.feed(" it stopped!");
    expect(mockHaptics.impactAsync).toHaveBeenCalledTimes(2);
  });

  it("does not tick inside a number, and a landed write ticks once", () => {
    const h = load();
    let now = 0;
    const ticker = h.createWritingTicker(() => now);
    ticker.feed("It cost 3");
    ticker.feed(".14 in all");
    expect(mockHaptics.impactAsync).not.toHaveBeenCalled();
    now += 1_000;
    ticker.landed();
    expect(mockHaptics.impactAsync).toHaveBeenCalledTimes(1);
  });
});
