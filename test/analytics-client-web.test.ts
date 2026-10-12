// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  set_config: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

function clearCookies() {
  for (const pair of document.cookie.split("; ")) {
    const name = pair.split("=")[0];
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

function seedStalePostHogStorage() {
  localStorage.setItem("ph_phc_test_posthog", JSON.stringify({ distinct_id: "stale" }));
  document.cookie = "ph_phc_test_posthog=stale; Path=/";
}

function phKeys(): string[] {
  return Object.keys(localStorage).filter((k) => k.startsWith("ph_"));
}

describe("analytics-client web consent gating", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    clearCookies();
    for (const fn of Object.values(posthog)) fn.mockClear();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://example.test");
  });

  it("initializes memory-only, opted out by default, when the first call is off (undecided or rejected)", async () => {
    const { setAnalyticsEnabled, getAnalytics } = await import("@/lib/analytics-client");
    const { NoopAnalyticsAdapter } = await import("@/lib/analytics-events");
    setAnalyticsEnabled(false);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init.mock.calls[0]![1]).toMatchObject({
      persistence: "memory",
      opt_out_capturing_by_default: true,
    });
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(getAnalytics()).toBeInstanceOf(NoopAnalyticsAdapter);
  });

  it("initializes already granted when the first call is on (a returning, consented visitor)", async () => {
    const { setAnalyticsEnabled, getAnalytics } = await import("@/lib/analytics-client");
    const { NoopAnalyticsAdapter } = await import("@/lib/analytics-events");
    setAnalyticsEnabled(true);
    expect(posthog.init.mock.calls[0]![1]).toMatchObject({
      persistence: "localStorage+cookie",
      opt_out_capturing_by_default: false,
    });
    expect(posthog.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(getAnalytics()).not.toBeInstanceOf(NoopAnalyticsAdapter);
  });

  it("never captures before accept, and starts capturing right after - no reload needed", async () => {
    const { setAnalyticsEnabled, getAnalytics } = await import("@/lib/analytics-client");
    setAnalyticsEnabled(false);
    getAnalytics().track("chat_message_sent", {});
    expect(posthog.capture).not.toHaveBeenCalled();

    setAnalyticsEnabled(true);
    expect(posthog.set_config).toHaveBeenCalledWith({ persistence: "localStorage+cookie" });
    expect(posthog.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });

    getAnalytics().track("chat_message_sent", {});
    expect(posthog.capture).toHaveBeenCalledTimes(1);
  });

  it("withdraws in order (opt out, then reset, then sweep) and leaves zero ph_* keys", async () => {
    const { setAnalyticsEnabled } = await import("@/lib/analytics-client");
    setAnalyticsEnabled(true);
    posthog.opt_out_capturing.mockClear();
    posthog.reset.mockClear();
    posthog.set_config.mockClear();
    seedStalePostHogStorage();
    expect(phKeys().length).toBeGreaterThan(0);

    const order: string[] = [];
    posthog.opt_out_capturing.mockImplementation(() => order.push("opt_out_capturing"));
    posthog.reset.mockImplementation(() => order.push("reset"));

    setAnalyticsEnabled(false);

    expect(order).toEqual(["opt_out_capturing", "reset"]);
    expect(posthog.set_config).toHaveBeenCalledWith({ persistence: "memory" });
    expect(phKeys()).toEqual([]);
    expect(document.cookie).not.toContain("ph_");
  });

  it("sweeps a pre-existing visitor's identifiers on the first load with no consent decision", async () => {
    seedStalePostHogStorage();
    expect(phKeys().length).toBeGreaterThan(0);
    const { setAnalyticsEnabled } = await import("@/lib/analytics-client");
    setAnalyticsEnabled(false);
    expect(phKeys()).toEqual([]);
  });

  it("is a no-op with no PostHog key configured, but still sweeps stale storage", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    seedStalePostHogStorage();
    const { setAnalyticsEnabled, getAnalytics } = await import("@/lib/analytics-client");
    const { NoopAnalyticsAdapter } = await import("@/lib/analytics-events");
    setAnalyticsEnabled(false);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(phKeys()).toEqual([]);
    expect(getAnalytics()).toBeInstanceOf(NoopAnalyticsAdapter);
  });

  it("does not reinitialize or re-fire opt-in/out on a redundant call with the same value", async () => {
    const { setAnalyticsEnabled } = await import("@/lib/analytics-client");
    setAnalyticsEnabled(true);
    posthog.opt_in_capturing.mockClear();
    setAnalyticsEnabled(true);
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
    expect(posthog.init).toHaveBeenCalledTimes(1);
  });
});
