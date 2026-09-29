import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeSubscription, isEntitling, resolveEntitlement, usagePeriod, type SubscriptionRow } from "@/lib/entitlements";
import { planLimits } from "@/lib/billing/config";
import { saveBillingEnv } from "./helpers/fake-billing";

const now = new Date("2026-09-29T12:00:00Z");
const day = 86_400_000;

function row(overrides: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    source: "stripe",
    productId: "price_pro_month",
    plan: "pro",
    interval: "month",
    status: "active",
    currentPeriodEnd: new Date(now.getTime() + 20 * day),
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("entitlement resolution", () => {
  let restoreEnv: () => void;
  beforeEach(() => {
    restoreEnv = saveBillingEnv();
  });
  afterEach(() => restoreEnv());

  it("is free with no subscriptions", () => {
    const e = resolveEntitlement([], 4, { metered: true, now });
    expect(e).toMatchObject({
      plan: "free",
      planName: "Free",
      source: null,
      manageUrl: null,
      usage: { period: "2026-09", aiRuns: 4 },
      limits: { aiRunsPerMonth: 30 },
      billing: { web: false, store: false },
    });
  });

  it("grants Pro from any source", () => {
    for (const source of ["stripe", "app_store", "play_store"]) {
      const e = resolveEntitlement([row({ source })], 0, { metered: true, now });
      expect(e.plan, source).toBe("pro");
      expect(e.source).toBe(source);
      expect(e.limits.aiRunsPerMonth).toBe(1500);
    }
  });

  it("counts trialing and past_due, not canceled, unpaid or incomplete", () => {
    for (const status of ["active", "trialing", "past_due"]) expect(isEntitling(row({ status }), now)).toBe(true);
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "expired"]) {
      expect(isEntitling(row({ status }), now), status).toBe(false);
    }
  });

  it("ends a store subscription at its period end even if the expiration webhook is late", () => {
    const lapsed = row({ source: "app_store", currentPeriodEnd: new Date(now.getTime() - day) });
    expect(isEntitling(lapsed, now)).toBe(false);
    // Stripe moves its own status, so a Stripe row trusts the status.
    expect(isEntitling({ ...lapsed, source: "stripe", status: "past_due" }, now)).toBe(true);
  });

  it("picks the subscription that runs longest when there are two", () => {
    const web = row({ source: "stripe", currentPeriodEnd: new Date(now.getTime() + 5 * day) });
    const store = row({ source: "play_store", currentPeriodEnd: new Date(now.getTime() + 300 * day), interval: "year" });
    expect(activeSubscription([web, store], now)).toBe(store);
    expect(resolveEntitlement([web, store], 0, { metered: true, now })).toMatchObject({
      source: "play_store",
      interval: "year",
    });
  });

  it("points store subscribers at the store to manage", () => {
    expect(resolveEntitlement([row({ source: "app_store" })], 0, { metered: true, now }).manageUrl).toBe(
      "https://apps.apple.com/account/subscriptions"
    );
    expect(
      resolveEntitlement([row({ source: "play_store", productId: "ciciro_pro:monthly" })], 0, { metered: true, now })
        .manageUrl
    ).toBe("https://play.google.com/store/account/subscriptions?sku=ciciro_pro&package=app.ciciro.mobile");
    expect(resolveEntitlement([row({})], 0, { metered: true, now }).manageUrl).toBeNull();
  });

  it("does not cap self-hosted use", () => {
    expect(resolveEntitlement([], 999, { metered: false, now }).limits).toEqual({ aiRunsPerMonth: null });
  });

  it("reads allowances from the environment, including unlimited", () => {
    process.env.CICIRO_FREE_AI_RUNS_PER_MONTH = "5";
    process.env.CICIRO_PRO_AI_RUNS_PER_MONTH = "unlimited";
    expect(planLimits("free")).toEqual({ aiRunsPerMonth: 5 });
    expect(planLimits("pro")).toEqual({ aiRunsPerMonth: null });
    process.env.CICIRO_FREE_AI_RUNS_PER_MONTH = "lots";
    expect(planLimits("free")).toEqual({ aiRunsPerMonth: 30 });
  });

  it("says what the server can sell only when fully configured", () => {
    process.env.STRIPE_SECRET_KEY = "sk";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_m";
    expect(resolveEntitlement([], 0, { metered: true, now }).billing.web).toBe(false);
    process.env.STRIPE_PRICE_PRO_YEARLY = "price_y";
    process.env.REVENUECAT_SECRET_API_KEY = "sk_rc";
    process.env.REVENUECAT_WEBHOOK_AUTH = "Bearer x";
    expect(resolveEntitlement([], 0, { metered: true, now }).billing).toEqual({ web: true, store: true });
  });

  it("meters by UTC calendar month", () => {
    expect(usagePeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(usagePeriod(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
  });
});
