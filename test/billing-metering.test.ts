import { describe, expect, it } from "vitest";
import { autowriteWeight } from "@/lib/billing/metering";

describe("autowriteWeight", () => {
  it("costs 6 units for the ~2,500-word reference run", () => {
    expect(autowriteWeight(2500)).toBe(6);
  });

  it("scales proportionally with the requested length", () => {
    expect(autowriteWeight(1250)).toBe(3);
    expect(autowriteWeight(5000)).toBe(12);
  });

  it("floors at 2 units even for a very short run", () => {
    expect(autowriteWeight(200)).toBe(2);
    expect(autowriteWeight(0)).toBe(2);
  });
});
