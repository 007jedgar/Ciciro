import { describe, expect, it } from "vitest";
import {
  MemoryAnalyticsAdapter,
  NoopAnalyticsAdapter,
  followIdentity,
  trackScreenView,
  type AnalyticsAdapter,
} from "@/lib/analytics-events";

/**
 * Stand-in "business logic": the shape every real call site follows
 * (identify on sign-in, a few feature events, a screen visit, reset on
 * sign-out). It depends only on AnalyticsAdapter, never on PostHog or any
 * other vendor - proving this same function runs unchanged against two
 * differently-implemented adapters is the test that the vendor-neutral
 * layer actually decouples call sites from the provider (see
 * docs/analytics.md).
 */
function runAppFlow(adapter: AnalyticsAdapter): void {
  adapter.registerSuperProperties({ platform: "web", appVersion: "1.2.3", release: "2026.10.1" });
  adapter.identify("user_123", { plan: "free", signupMethod: "email" });
  const leaveEditor = trackScreenView(adapter, "editor", { projectId: "proj_1" });
  adapter.track("project_created", { kind: "novel", isFirstProject: true });
  adapter.track("quick_action_used", { action: "continue", kind: "novel" });
  adapter.track("suggestion_accepted", {});
  leaveEditor();
  adapter.reset();
}

/**
 * A second, independently-implemented adapter with no PostHog involved -
 * standing in for "swap PostHog for Firebase down the line." If
 * runAppFlow() above needed to change to work against this, the business
 * logic would not actually be decoupled from the vendor.
 */
class SecondVendorAdapter implements AnalyticsAdapter {
  events: { kind: string; payload: unknown }[] = [];

  identify(userId: string, properties?: Record<string, unknown>): void {
    this.events.push({ kind: "identify", payload: { userId, properties } });
  }
  reset(): void {
    this.events.push({ kind: "reset", payload: null });
  }
  track(event: string, properties: unknown): void {
    this.events.push({ kind: "track", payload: { event, properties } });
  }
  screen(name: string, properties?: Record<string, unknown>): void {
    this.events.push({ kind: "screen", payload: { name, properties } });
  }
  registerSuperProperties(properties: Record<string, unknown>): void {
    this.events.push({ kind: "super", payload: properties });
  }
  setOptedOut(optedOut: boolean): void {
    this.events.push({ kind: "optedOut", payload: optedOut });
  }
  deleteUser(userId: string): void {
    this.events.push({ kind: "deleteUser", payload: userId });
  }
}

describe("AnalyticsAdapter decoupling", () => {
  it("runs the same call sites against the in-memory fake adapter", () => {
    const adapter = new MemoryAnalyticsAdapter();
    runAppFlow(adapter);

    expect(adapter.identifies).toEqual([
      { userId: "user_123", properties: { plan: "free", signupMethod: "email" } },
    ]);
    expect(adapter.screens).toEqual([{ name: "editor", properties: { projectId: "proj_1" } }]);
    expect(adapter.tracks.map((t) => t.event)).toEqual([
      "project_created",
      "quick_action_used",
      "suggestion_accepted",
      "screen_duration",
    ]);
    expect(adapter.resetCount).toBe(1);
    expect(adapter.superProperties).toEqual({
      platform: "web",
      appVersion: "1.2.3",
      release: "2026.10.1",
    });
  });

  it("runs unchanged against a second, unrelated adapter implementation", () => {
    const adapter = new SecondVendorAdapter();
    runAppFlow(adapter);

    const kinds = adapter.events.map((e) => e.kind);
    expect(kinds).toEqual(["super", "identify", "screen", "track", "track", "track", "track", "reset"]);
  });

  it("is a true no-op with no provider configured, never throwing", () => {
    const adapter = new NoopAnalyticsAdapter();
    expect(() => runAppFlow(adapter)).not.toThrow();
  });
});

describe("followIdentity", () => {
  it("never resets an anonymous visitor, so pre-signup activity joins the account", () => {
    const adapter = new MemoryAnalyticsAdapter();
    let identity = followIdentity(adapter, null, null);
    identity = followIdentity(adapter, identity, null);
    expect(adapter.resetCount).toBe(0);

    identity = followIdentity(adapter, identity, "user_1");
    expect(identity).toBe("user_1");
    expect(adapter.resetCount).toBe(0);
    expect(adapter.identifies).toEqual([{ userId: "user_1", properties: undefined }]);
  });

  it("identifies once per account and resets only on a real sign-out or switch", () => {
    const adapter = new MemoryAnalyticsAdapter();
    let identity = followIdentity(adapter, null, "user_1");
    identity = followIdentity(adapter, identity, "user_1");
    expect(adapter.identifies).toHaveLength(1);

    identity = followIdentity(adapter, identity, "user_2");
    expect(adapter.resetCount).toBe(1);
    expect(adapter.identifies.map((i) => i.userId)).toEqual(["user_1", "user_2"]);

    identity = followIdentity(adapter, identity, null);
    expect(identity).toBeNull();
    expect(adapter.resetCount).toBe(2);
  });
});
