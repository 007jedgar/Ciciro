// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalyticsAdapter } from "@/lib/analytics-events";
import AiLimitDialog from "@/components/AiLimitDialog";
import SettingsBilling from "@/components/SettingsBilling";
import DeleteAccountDialog from "@/components/DeleteAccountDialog";
import { allowanceResetsOn, reportAiLimit, type Entitlement } from "@/lib/billing-client";
import { formatPrice } from "@/lib/billing/prices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({ adapter: null as unknown as MemoryAnalyticsAdapter }));
vi.mock("@/lib/analytics-client", () => ({ getAnalytics: () => analytics.adapter }));

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
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
    usage: { period: "2026-09", aiRuns: 30 },
    billing: { web: true, store: false },
    manageUrl: null,
    ...overrides,
  };
}

const pro = (overrides: Partial<Entitlement> = {}) =>
  entitlement({
    plan: "pro",
    planName: "Ciciro Pro",
    source: "stripe",
    status: "active",
    interval: "month",
    currentPeriodEnd: "2026-10-29T12:00:00.000Z",
    limits: { aiRunsPerMonth: 1500 },
    usage: { period: "2026-09", aiRuns: 12 },
    ...overrides,
  });

let root: Root;
let host: HTMLDivElement;

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}

const text = () => document.body.textContent ?? "";

describe("billing on the web", () => {
  beforeEach(() => {
    analytics.adapter = new MemoryAnalyticsAdapter();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  describe("the limit-reached dialog", () => {
    it("opens on a 402 from any AI request and offers Pro", async () => {
      await render(<AiLimitDialog />);
      expect(document.querySelector(".ai-limit-dialog")).toBeNull();
      await act(async () => {
        expect(
          reportAiLimit(402, {
            error: "You've used this month's free AI allowance.",
            code: "ai_limit_reached",
            entitlement: entitlement(),
          })
        ).toBe(true);
      });
      expect(text()).toContain("You've used this month's free AI allowance.");
      expect(text()).toContain("30 of 30 AI actions used. Your allowance starts over on October 1.");
      const upgrade = document.querySelector<HTMLAnchorElement>('a[href="/pricing"]');
      expect(upgrade?.textContent).toBe("See Ciciro Pro");
    });

    it("has no upgrade when the web does not sell Pro, or the account already has it", async () => {
      await render(<AiLimitDialog />);
      await act(async () => {
        reportAiLimit(402, { code: "ai_limit_reached", entitlement: entitlement({ billing: { web: false, store: false } }) });
      });
      expect(document.querySelector('a[href="/pricing"]')).toBeNull();
      await act(async () => {
        reportAiLimit(402, { code: "ai_limit_reached", entitlement: pro({ usage: { period: "2026-09", aiRuns: 1500 } }) });
      });
      expect(document.querySelector('a[href="/pricing"]')).toBeNull();
    });

    it("ignores other errors", () => {
      expect(reportAiLimit(402, { error: "nope" })).toBe(false);
      expect(reportAiLimit(500, { code: "ai_limit_reached" })).toBe(false);
    });
  });

  describe("the Settings plan section", () => {
    it("shows a free account its usage and the way up", async () => {
      await render(<SettingsBilling entitlement={entitlement({ usage: { period: "2026-09", aiRuns: 12 } })} />);
      expect(text()).toContain("12 of 30 AI actions this month");
      expect(text()).toContain("resets Oct 1");
      const upgrade = document.querySelector<HTMLAnchorElement>('a[href="/pricing"]')!;
      expect(upgrade.textContent).toBe("Upgrade to Ciciro Pro");
      await act(async () => upgrade.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
      expect(analytics.adapter.tracks).toEqual([
        { event: "cta_clicked", properties: { cta: "upgrade_to_pro", surface: "settings" }, options: undefined },
      ]);
    });

    it("sends a web subscriber to the Customer Portal", async () => {
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, assign });
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: "https://billing.stripe.test/p" }))));
      await render(<SettingsBilling entitlement={pro()} />);
      expect(text()).toContain("Renews");
      const manage = [...document.querySelectorAll("button")].find((b) => b.textContent === "Manage billing")!;
      await act(async () => manage.click());
      expect(assign).toHaveBeenCalledWith("https://billing.stripe.test/p");
    });

    it("points a store subscriber at the store, never at web checkout", async () => {
      await render(
        <SettingsBilling
          entitlement={pro({ source: "app_store", manageUrl: "https://apps.apple.com/account/subscriptions" })}
        />
      );
      expect(text()).toContain("Billed through the App Store");
      expect(document.querySelector('a[href="https://apps.apple.com/account/subscriptions"]')).not.toBeNull();
      expect(document.querySelector('a[href="/pricing"]')).toBeNull();
    });

    it("stays out of the way when nothing is metered or for sale", async () => {
      await render(
        <SettingsBilling
          entitlement={entitlement({ metered: false, limits: { aiRunsPerMonth: null }, billing: { web: false, store: false } })}
        />
      );
      expect(text()).toBe("");
    });
  });

  describe("deleting an account with a subscription", () => {
    it("tells a store subscriber billing continues until they cancel with Apple", async () => {
      const store = pro({ source: "app_store", manageUrl: "https://apps.apple.com/account/subscriptions" });
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entitlement: store }))));
      await render(<DeleteAccountDialog open email="ada@example.com" hasPassword onClose={() => {}} />);
      expect(text()).toContain("billed through the App Store");
      expect(text()).toContain("billing continues until you cancel it there");
      expect(document.querySelector('.account-dialog-billing a[href="https://apps.apple.com/account/subscriptions"]')).not.toBeNull();
    });

    it("tells a web subscriber the subscription ends with the account", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entitlement: pro() }))));
      await render(<DeleteAccountDialog open email="ada@example.com" hasPassword onClose={() => {}} />);
      expect(text()).toContain("Your Ciciro Pro subscription is cancelled at once");
    });
  });

  it("formats prices and reset dates", () => {
    expect(formatPrice(1200, "usd")).toBe("$12");
    expect(formatPrice(999, "usd")).toBe("$9.99");
    expect(formatPrice(9600, "eur")).toBe("€96");
    expect(allowanceResetsOn("2026-12")).toContain("January");
    expect(allowanceResetsOn("2026-09", "short")).toBe("Oct 1");
  });
});
