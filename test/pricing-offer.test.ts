import { describe, expect, it } from "vitest";
import { discounted, offerHeadline, offerTerm, type DisplayOffer } from "@/lib/billing/prices";

const offer = (overrides: Partial<DisplayOffer>): DisplayOffer => ({
  percentOff: 50,
  duration: 12,
  endsAt: null,
  prices: {},
  ...overrides,
});

describe("the early-access offer's wording", () => {
  it("says what the coupon gives, never more", () => {
    expect(offerHeadline(offer({ percentOff: 50 }))).toBe("Half price");
    expect(offerHeadline(offer({ percentOff: 100 }))).toBe("Free");
    expect(offerHeadline(offer({ percentOff: 40 }))).toBe("40% off");
  });

  it("names how long it lasts on each billing period", () => {
    expect(offerTerm(offer({ duration: 12 }), "month")).toBe("for your first year");
    expect(offerTerm(offer({ duration: 12 }), "year")).toBe("for your first year");
    expect(offerTerm(offer({ duration: 3 }), "month")).toBe("for your first 3 months");
    // Stripe discounts every bill that falls in the coupon's months.
    expect(offerTerm(offer({ duration: 3 }), "year")).toBe("for your first year");
    expect(offerTerm(offer({ duration: 24 }), "year")).toBe("for your first 2 years");
    expect(offerTerm(offer({ duration: 1 }), "month")).toBe("for your first month");
    expect(offerTerm(offer({ duration: "once" }), "month")).toBe("for your first month");
    expect(offerTerm(offer({ duration: "once" }), "year")).toBe("for your first year");
    expect(offerTerm(offer({ duration: "forever" }), "month")).toBe("for as long as you subscribe");
  });

  it("takes the percent off to the cent", () => {
    const price = { interval: "month" as const, amount: 999, currency: "usd", label: "$9.99" };
    expect(discounted(price, 50)).toEqual({ ...price, amount: 500, label: "$5" });
    expect(discounted(price, 100)).toMatchObject({ amount: 0, label: "$0" });
  });
});
