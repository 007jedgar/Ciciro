import { barShare, formatWeekRange, weeklyReviewHref } from "../lib/weekly-review";

describe("weekly review helpers", () => {
  it("links to the project's review screen", () => {
    expect(weeklyReviewHref("p1")).toBe("/project/p1/weekly-review");
  });

  it("formats the week as a short range in local time", () => {
    expect(formatWeekRange("2026-09-20", "2026-09-26", "en-US")).toBe("Sep 20 to Sep 26");
  });

  it("scales bars to the busiest day and never draws a flat one", () => {
    expect(barShare(500, 500)).toBe(1);
    expect(barShare(250, 500)).toBe(0.5);
    expect(barShare(0, 500)).toBe(0.06);
    expect(barShare(0, 0)).toBe(0.06);
  });
});
