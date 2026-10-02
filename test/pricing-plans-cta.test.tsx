// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalyticsAdapter } from "@/lib/analytics-events";
import type { DisplayPrice } from "@/lib/billing/prices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({ adapter: null as unknown as MemoryAnalyticsAdapter }));
vi.mock("@/lib/analytics-client", () => ({ getAnalytics: () => analytics.adapter }));
vi.mock("@/lib/billing-client", () => ({
  fetchEntitlement: async () => null,
  startCheckout: async () => ({ url: "https://checkout.stripe.test/s" }),
  openBillingPortal: async () => ({ url: "https://billing.stripe.test/p" }),
  storeName: () => null,
  billingDate: (iso: string) => iso,
}));

import PricingPlans from "@/app/pricing/PricingPlans";

const price = (amount: number): DisplayPrice => ({ interval: "month", amount, currency: "usd", label: `$${amount / 100}` });

describe("PricingPlans click-through", () => {
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

  function clickFirst(selector: string) {
    const el = host.querySelector<HTMLElement>(selector)!;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  it("fires cta_clicked for a signed-out visitor's free-plan CTA", async () => {
    await act(async () =>
      root.render(
        <PricingPlans
          signedIn={false}
          entitlement={null}
          prices={{ month: price(1200) }}
          offer={null}
          limits={{ free: 30, pro: 1500 }}
          justSubscribed={false}
        />
      )
    );
    await act(async () => clickFirst('a[href^="/signup"].pricing-cta:not(.primary)'));
    expect(analytics.adapter.tracks.map((t) => t.event)).toContain("cta_clicked");
    expect(analytics.adapter.tracks.find((t) => t.event === "cta_clicked")?.properties).toEqual({
      cta: "start_writing_free",
      surface: "pricing",
    });
  });

  it("fires cta_clicked for a signed-out visitor's Pro CTA", async () => {
    await act(async () =>
      root.render(
        <PricingPlans
          signedIn={false}
          entitlement={null}
          prices={{ month: price(1200) }}
          offer={null}
          limits={{ free: 30, pro: 1500 }}
          justSubscribed={false}
        />
      )
    );
    await act(async () => clickFirst("a.pricing-cta.primary"));
    expect(analytics.adapter.tracks.find((t) => t.event === "cta_clicked")?.properties).toEqual({
      cta: "create_account_to_subscribe",
      surface: "pricing",
    });
  });

  it("fires cta_clicked alongside paywall_cta_clicked when a signed-in free account starts checkout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}))));
    await act(async () =>
      root.render(
        <PricingPlans
          signedIn
          entitlement={{
            plan: "free",
            planName: "Free",
            source: null,
            status: null,
            interval: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            metered: true,
            limits: { aiRunsPerMonth: 30 },
            plans: { free: { aiRunsPerMonth: 30 }, pro: { aiRunsPerMonth: 1500 } },
            usage: { period: "2026-09", aiRuns: 0 },
            billing: { web: true, store: false },
            manageUrl: null,
          }}
          prices={{ month: price(1200) }}
          offer={null}
          limits={{ free: 30, pro: 1500 }}
          justSubscribed={false}
        />
      )
    );
    await act(async () => clickFirst("button.pricing-cta.primary"));
    expect(analytics.adapter.tracks.map((t) => t.event)).toEqual(
      expect.arrayContaining(["paywall_cta_clicked", "cta_clicked"])
    );
    expect(analytics.adapter.tracks.find((t) => t.event === "cta_clicked")?.properties).toEqual({
      cta: "upgrade_to_pro",
      surface: "pricing",
    });
  });
});
