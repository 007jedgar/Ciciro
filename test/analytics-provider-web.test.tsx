// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalyticsAdapter } from "@/lib/analytics-events";
import { SETTINGS_SYNC_EVENT } from "@/lib/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({ adapter: null as unknown as MemoryAnalyticsAdapter }));
const route = vi.hoisted(() => ({ pathname: "/" }));
const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
}));

vi.mock("@/lib/analytics-client", () => ({ getAnalytics: () => analytics.adapter }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ refresh: () => {}, push: (path: string) => (route.pathname = path) }),
}));
vi.mock("@/components/SettingsProvider", () => ({
  useSettings: () => ({ settings: { analyticsEnabled: true } }),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

import AccountBar from "@/components/AccountBar";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import { createPostHogWebAdapter } from "@/lib/analytics-posthog-web";

function meReturns(userId: string | null) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ user: userId ? { id: userId } : null })));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe("AnalyticsProvider screen tracking", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    analytics.adapter = new MemoryAnalyticsAdapter();
    route.pathname = "/";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("does not record a phantom screen view when sign-in state flips on the same route", async () => {
    meReturns("user_1");
    act(() => root.render(<AnalyticsProvider />));
    await flush();
    expect(analytics.adapter.screens.map((s) => s.name)).toEqual(["library"]);

    // Sign out from "/": the session event re-checks identity before the route changes.
    meReturns(null);
    await act(async () => {
      window.dispatchEvent(new Event(SETTINGS_SYNC_EVENT));
    });
    await flush();

    expect(analytics.adapter.resetCount).toBe(1);
    expect(analytics.adapter.screens.map((s) => s.name)).toEqual(["library"]);
    expect(analytics.adapter.tracks.filter((t) => t.event === "screen_duration")).toEqual([]);
  });

  it("labels the next route with the resolved sign-in state", async () => {
    meReturns(null);
    act(() => root.render(<AnalyticsProvider />));
    await flush();
    expect(analytics.adapter.screens.map((s) => s.name)).toEqual(["landing"]);

    route.pathname = "/login";
    act(() => root.render(<AnalyticsProvider />));
    expect(analytics.adapter.screens.map((s) => s.name)).toEqual(["landing", "login"]);
    expect(analytics.adapter.tracks.filter((t) => t.event === "screen_duration").map((t) => t.properties.screen)).toEqual([
      "landing",
    ]);
  });

  it("records the last screen's duration under the account before a sign-out resets identity", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      new Response(JSON.stringify(url === "/api/auth/me" ? { user: { id: "user_1", email: "a@b.c", name: "A" } } : {}))
    );
    const order: string[] = [];
    const adapter = analytics.adapter;
    const reset = adapter.reset.bind(adapter);
    const track = adapter.track.bind(adapter);
    adapter.reset = () => {
      order.push("reset");
      reset();
    };
    adapter.track = (event, properties) => {
      order.push(event);
      track(event, properties);
    };
    act(() =>
      root.render(
        <>
          <AnalyticsProvider />
          <AccountBar />
        </>
      )
    );
    await flush();
    meReturns(null);

    const signOut = host.querySelector("button");
    await act(async () => signOut!.click());
    await flush();
    act(() =>
      root.render(
        <>
          <AnalyticsProvider />
          <AccountBar />
        </>
      )
    );

    expect(order).toEqual(["signed_out", "screen_duration", "reset"]);
    expect(adapter.resetCount).toBe(1);
    expect(adapter.screens.map((s) => s.name)).toEqual(["library", "login"]);
  });

  it("commits the active screen's duration (beacon-safe) when the tab is hidden, and resumes when visible again", async () => {
    meReturns("user_1");
    act(() => root.render(<AnalyticsProvider />));
    await flush();
    expect(analytics.adapter.screens.map((s) => s.name)).toEqual(["library"]);

    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(analytics.adapter.tracks.map((t) => [t.event, t.options])).toEqual([
      ["screen_duration", { beacon: true }],
    ]);

    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    // A second pause (route change) must not double-count the hidden stretch.
    await act(async () => root.unmount());
    expect(analytics.adapter.tracks.map((t) => t.event)).toEqual(["screen_duration", "screen_duration"]);
    expect(analytics.adapter.tracks[1]!.options).toBeUndefined();
    visibility.mockRestore();
  });

  it("does not count time a screen spent opened in a background tab", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    meReturns("user_1");
    act(() => root.render(<AnalyticsProvider />));
    await flush();
    expect(analytics.adapter.screens.map((s) => s.name)).toEqual(["library"]);

    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(analytics.adapter.tracks).toEqual([]);

    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(analytics.adapter.tracks).toEqual([]);
    await act(async () => root.unmount());
    expect(analytics.adapter.tracks).toEqual([
      { event: "screen_duration", properties: expect.objectContaining({ screen: "library" }), options: undefined },
    ]);
    visibility.mockRestore();
  });

  it("commits the active screen's duration (beacon-safe) on pagehide, so closing the tab is not lost", async () => {
    meReturns("user_1");
    act(() => root.render(<AnalyticsProvider />));
    await flush();

    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(analytics.adapter.tracks).toEqual([
      { event: "screen_duration", properties: expect.objectContaining({ screen: "library" }), options: { beacon: true } },
    ]);
  });

  it("records cta_clicked for an email's link, source email, and strips src/cta from the URL", async () => {
    meReturns("user_1");
    window.history.replaceState(null, "", "/pricing?src=email&cta=allowance_nudge");
    route.pathname = "/pricing";
    act(() => root.render(<AnalyticsProvider />));
    await flush();

    expect(analytics.adapter.tracks.filter((t) => t.event === "cta_clicked")).toEqual([
      { event: "cta_clicked", properties: { cta: "allowance_nudge", surface: "paywall", source: "email" }, options: undefined },
    ]);
    expect(window.location.search).toBe("");
  });

  it("does nothing when a page opens with no email src/cta", async () => {
    meReturns("user_1");
    window.history.replaceState(null, "", "/");
    route.pathname = "/";
    act(() => root.render(<AnalyticsProvider />));
    await flush();

    expect(analytics.adapter.tracks.filter((t) => t.event === "cta_clicked")).toEqual([]);
  });
});

describe("AccountBar", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    analytics.adapter = new MemoryAnalyticsAdapter();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("fires cta_clicked when a free account clicks Upgrade", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            user: { id: "user_1", email: "a@b.c", name: "A" },
            entitlement: { plan: "free", billing: { web: true } },
          })
        )
    );
    act(() => root.render(<AccountBar />));
    await flush();
    const upgrade = host.querySelector<HTMLAnchorElement>(".account-upgrade")!;
    expect(upgrade.textContent).toBe("Upgrade");
    await act(async () => upgrade.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(analytics.adapter.tracks).toEqual([
      { event: "cta_clicked", properties: { cta: "upgrade_to_pro", surface: "account_bar" }, options: undefined },
    ]);
  });
});

describe("PostHog web adapter opt-in", () => {
  it("opts in without capturing an $opt_in event", () => {
    const adapter = createPostHogWebAdapter({ apiKey: "phc_test", apiHost: "https://example.test" });
    adapter.setOptedOut(false);
    expect(posthog.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
  });
});
