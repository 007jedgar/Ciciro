import { describe, expect, it } from "vitest";
import { dailyEarns, dailyProseCredits, proseBonusTier } from "@/lib/gamification/credits";

describe("prose bonus tiers", () => {
  it("pays the full stipend when at least 70% of new stock is human-typed", () => {
    expect(proseBonusTier(520, 0, 0)).toBe("full");
    expect(dailyProseCredits("full", true)).toBe(15);
  });

  it("pays a smaller stipend on a mixed day (40-70% human)", () => {
    // 520 / 820 = 63%
    expect(proseBonusTier(520, 300, 0)).toBe("mixed");
    expect(dailyProseCredits("mixed", true)).toBe(5);
  });

  it("pays nothing when the day is AI-heavy, even if some words were typed", () => {
    expect(proseBonusTier(40, 5000, 0)).toBe("none");
    expect(dailyProseCredits("none", true)).toBe(0);
    expect(dailyProseCredits("full", false)).toBe(0);
  });

  it("grants return + full prose once per local day with a daily cap", () => {
    const earns = dailyEarns({
      userId: "u1",
      localDate: "2026-09-02",
      returnClosed: true,
      proseClosed: true,
      chairClosed: true,
      humanTyped: 520,
      aiInserted: 0,
      pasted: 0,
    });
    expect(earns.map((e) => e.reason)).toEqual(["earn_return", "earn_prose_full"]);
    expect(earns.reduce((sum, e) => sum + e.amount, 0)).toBe(17);
    expect(earns[1].idempotencyKey).toBe("earn_prose_full:u1:2026-09-02");
  });

  it("does not stack the chair stipend on a prose bonus day", () => {
    const earns = dailyEarns({
      userId: "u1",
      localDate: "2026-09-02",
      returnClosed: true,
      proseClosed: true,
      chairClosed: true,
      humanTyped: 520,
      aiInserted: 300,
      pasted: 0,
    });
    expect(earns.map((e) => e.reason)).toEqual(["earn_return", "earn_prose_mixed"]);
  });

  it("pays the revision-day chair stipend when Prose stays open", () => {
    const earns = dailyEarns({
      userId: "u1",
      localDate: "2026-09-02",
      returnClosed: true,
      proseClosed: false,
      chairClosed: true,
      humanTyped: 40,
      aiInserted: 0,
      pasted: 0,
    });
    expect(earns.map((e) => e.reason)).toEqual(["earn_return", "earn_chair"]);
    expect(earns.reduce((sum, e) => sum + e.amount, 0)).toBe(3);
  });
});
