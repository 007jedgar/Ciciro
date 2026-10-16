import { getAnalytics } from "../lib/analytics-client";
import { REVIEW_SETTLE_MS } from "../lib/review-prompt";

const mockStore = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => void mockStore.set(key, value),
  }),
}));
jest.mock("../lib/analytics-client", () => {
  const track = jest.fn();
  return { getAnalytics: () => ({ track }) };
});
jest.mock("expo-store-review", () => ({
  isAvailableAsync: jest.fn(),
  hasAction: jest.fn(),
  requestReview: jest.fn(),
}));

const StoreReview = jest.requireMock("expo-store-review") as {
  isAvailableAsync: jest.Mock;
  hasAction: jest.Mock;
  requestReview: jest.Mock;
};
const track = getAnalytics().track as jest.Mock;

/**
 * A fresh copy of the module, as a fresh launch would load it (its in-memory flag
 * starts clean), with the AppState it sees: `foreground` stands in for the app
 * being in front, and `listeners` are the change handlers it registered.
 */
function freshModule(state: "active" | "background" = "active") {
  let mod!: typeof import("../lib/review-prompt");
  jest.isolateModules(() => {
    mod = require("../lib/review-prompt");
  });
  // react-native resolves AppState lazily, so the module reads the same one this does, outside the isolation.
  const { AppState } = require("react-native") as typeof import("react-native");
  Object.defineProperty(AppState, "currentState", { value: state, writable: true, configurable: true });
  const remove = jest.fn();
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, listener: (state: string) => void) => {
    listeners.push(listener);
    return { remove };
  }) as never);
  return {
    ...mod,
    remove,
    listeners,
    setState: (next: string) => Object.defineProperty(AppState, "currentState", { value: next, writable: true }),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear();
  track.mockClear();
  StoreReview.isAvailableAsync.mockReset().mockResolvedValue(true);
  StoreReview.hasAction.mockReset().mockResolvedValue(true);
  StoreReview.requestReview.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("requestReviewOnce", () => {
  it("asks the OS, records it, and tracks the trigger", async () => {
    const { requestReviewOnce: ask, hasAskedForReview: asked } = freshModule();
    await expect(ask("export")).resolves.toBe(true);
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(mockStore.get("review-prompt-asked")).toBe("true");
    expect(asked()).toBe(true);
    expect(track).toHaveBeenCalledWith("review_prompt_requested", { trigger: "export" });
  });

  it("asks only once across triggers", async () => {
    const { requestReviewOnce: ask } = freshModule();
    await expect(ask("exercise")).resolves.toBe(true);
    await expect(ask("export")).resolves.toBe(false);
    await expect(ask("exercise")).resolves.toBe(false);
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it("does not ask again after a relaunch", async () => {
    mockStore.set("review-prompt-asked", "true");
    const { requestReviewOnce: ask } = freshModule();
    await expect(ask("export")).resolves.toBe(false);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });

  it("two triggers racing ask once", async () => {
    const { requestReviewOnce: ask } = freshModule();
    const results = await Promise.all([ask("export"), ask("exercise")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it("is a no-op, and keeps the one ask, where the platform has no prompt", async () => {
    StoreReview.isAvailableAsync.mockResolvedValue(false);
    const { requestReviewOnce: ask, hasAskedForReview: asked } = freshModule();
    await expect(ask("export")).resolves.toBe(false);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
    expect(asked()).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it("is a no-op when the store has no action to send the person to", async () => {
    StoreReview.hasAction.mockResolvedValue(false);
    const { requestReviewOnce: ask } = freshModule();
    await expect(ask("exercise")).resolves.toBe(false);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });

  it("swallows a failed request and does not ask again", async () => {
    StoreReview.requestReview.mockRejectedValue(new Error("native module missing"));
    const { requestReviewOnce: ask } = freshModule();
    await expect(ask("export")).resolves.toBe(false);
    await expect(ask("export")).resolves.toBe(false);
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });
});

describe("scheduleReviewPrompt", () => {
  it("waits for the success moment to settle before asking", async () => {
    const { scheduleReviewPrompt: schedule } = freshModule();
    schedule("exercise");
    await jest.advanceTimersByTimeAsync(REVIEW_SETTLE_MS - 1);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("review_prompt_requested", { trigger: "exercise" });
  });

  it("holds the ask while a system sheet has the app in the background, then gives it a beat", async () => {
    const { scheduleReviewPrompt: schedule, listeners, remove, setState } = freshModule("background");
    schedule("export");
    await jest.advanceTimersByTimeAsync(REVIEW_SETTLE_MS * 3);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();

    setState("active");
    listeners.forEach((listener) => listener("active"));
    await jest.advanceTimersByTimeAsync(REVIEW_SETTLE_MS - 1);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalled();
  });

  it("never asks when cancelled first", async () => {
    const { scheduleReviewPrompt: schedule } = freshModule();
    const cancel = schedule("exercise");
    cancel();
    await jest.advanceTimersByTimeAsync(REVIEW_SETTLE_MS * 2);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });

  it("schedules nothing once the device has been asked", async () => {
    mockStore.set("review-prompt-asked", "true");
    const { scheduleReviewPrompt: schedule } = freshModule();
    schedule("export");
    await jest.advanceTimersByTimeAsync(REVIEW_SETTLE_MS * 2);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });
});
