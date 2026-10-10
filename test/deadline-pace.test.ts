import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  deadlineSnapshot,
  recentWordsPerDay,
  suggestedWordGoal,
  type WritingDayWords,
} from "@/lib/deadline-pace";

const TODAY = "2026-10-09";

/** `perDay` words on each of the `count` days ending yesterday. */
function steady(perDay: number, count: number): WritingDayWords[] {
  return Array.from({ length: count }, (_, i) => ({ date: addDays(TODAY, -(i + 1)), words: perDay }));
}

describe("day arithmetic", () => {
  it("counts calendar days across month ends and clock changes", () => {
    expect(daysBetween("2026-10-09", "2026-10-09")).toBe(0);
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-11-01", "2026-10-31")).toBe(-1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("recent writing pace", () => {
  it("averages the finished days in the window and leaves today out", () => {
    const days = [...steady(500, 14), { date: TODAY, words: 9_000 }];
    expect(recentWordsPerDay(days, TODAY)).toBe(500);
  });

  it("counts the quiet days in the window", () => {
    const days = [
      { date: addDays(TODAY, -1), words: 700 },
      { date: addDays(TODAY, -4), words: 700 },
    ];
    // First written day is 4 days back: 4 days in the window, 1400 words.
    expect(recentWordsPerDay(days, TODAY)).toBe(350);
  });

  it("does not stretch a new writer's pace across days before they began", () => {
    expect(recentWordsPerDay(steady(400, 3), TODAY)).toBe(400);
  });

  it("averages a returning writer over the whole window, lull included", () => {
    const days = [{ date: addDays(TODAY, -40), words: 800 }, { date: addDays(TODAY, -1), words: 1_400 }];
    expect(recentWordsPerDay(days, TODAY)).toBe(100);
  });

  it("ignores days older than the window", () => {
    expect(recentWordsPerDay([{ date: addDays(TODAY, -15), words: 5_000 }], TODAY)).toBe(0);
  });

  it("is zero with nothing written", () => {
    expect(recentWordsPerDay([], TODAY)).toBe(0);
  });
});

describe("deadline snapshot", () => {
  const base = { wordGoal: 10_000, manuscriptWords: 4_000, today: TODAY };

  it("is on track when the recent pace covers what is needed", () => {
    // 6000 left over 10 days (today included) = 600 a day; writing 600.
    const s = deadlineSnapshot({ ...base, deadline: "2026-10-18", days: steady(600, 14) });
    expect(s).toMatchObject({
      status: "onTrack",
      remaining: 6_000,
      daysLeft: 10,
      neededPerDay: 600,
      recentPerDay: 600,
      progress: 0.4,
    });
  });

  it("is comfortably ahead when writing well over the need", () => {
    const s = deadlineSnapshot({ ...base, deadline: "2026-10-18", days: steady(900, 14) });
    expect(s.status).toBe("ahead");
  });

  it("needs a faster pace when writing under the need", () => {
    const s = deadlineSnapshot({ ...base, deadline: "2026-10-18", days: steady(300, 14) });
    expect(s).toMatchObject({ status: "behind", neededPerDay: 600, recentPerDay: 300 });
  });

  it("holds the edges: 85% is on track, just under is behind, 125% is ahead", () => {
    const at = (perDay: number) =>
      deadlineSnapshot({ ...base, deadline: "2026-10-18", days: steady(perDay, 14) }).status;
    expect(at(510)).toBe("onTrack");
    expect(at(509)).toBe("behind");
    expect(at(750)).toBe("ahead");
    expect(at(749)).toBe("onTrack");
  });

  it("rounds the daily need up so it is never short", () => {
    const s = deadlineSnapshot({ wordGoal: 1_000, manuscriptWords: 0, deadline: "2026-10-11", days: [], today: TODAY });
    expect(s.neededPerDay).toBe(334);
  });

  it("has nothing to compare before any words are written", () => {
    const s = deadlineSnapshot({ ...base, deadline: "2026-10-18", days: [] });
    expect(s).toMatchObject({ status: "gettingStarted", neededPerDay: 600, recentPerDay: null });
  });

  it("does not read one burst after a lull as ahead", () => {
    // 600 a day needed; months of writing, then 13 quiet days and 1,000 words yesterday.
    const days = [...steady(500, 60).filter((d) => d.date < addDays(TODAY, -14)), { date: addDays(TODAY, -1), words: 1_000 }];
    const s = deadlineSnapshot({ ...base, deadline: "2026-10-18", days });
    expect(s).toMatchObject({ status: "behind", neededPerDay: 600, recentPerDay: 71 });
  });

  it("tells a writer who has stalled to pick up the pace, with the words a day needed", () => {
    const days = [{ date: addDays(TODAY, -20), words: 900 }];
    const s = deadlineSnapshot({ ...base, deadline: "2026-10-18", days });
    expect(s).toMatchObject({ status: "behind", neededPerDay: 600, recentPerDay: 0 });
  });

  it("keeps a first-time writer getting started, and averages their first days alone", () => {
    expect(deadlineSnapshot({ ...base, deadline: "2026-10-18", days: [] }).status).toBe("gettingStarted");
    const s = deadlineSnapshot({ ...base, deadline: "2026-10-18", days: steady(700, 2) });
    expect(s).toMatchObject({ status: "onTrack", recentPerDay: 700 });
  });

  it("counts the due date itself as a day to write", () => {
    const s = deadlineSnapshot({ ...base, deadline: TODAY, days: steady(6_000, 14) });
    expect(s).toMatchObject({ daysLeft: 1, neededPerDay: 6_000 });
  });

  it("is complete once the words reach the target, even after the date", () => {
    const s = deadlineSnapshot({ ...base, manuscriptWords: 10_400, deadline: "2026-10-01", days: [] });
    expect(s).toMatchObject({ status: "complete", progress: 1, remaining: 0, neededPerDay: null });
  });

  it("says plainly when the date has passed with words to go", () => {
    const s = deadlineSnapshot({ ...base, deadline: "2026-10-08", days: steady(600, 14) });
    expect(s).toMatchObject({ status: "pastDue", daysLeft: 0, remaining: 6_000, neededPerDay: null });
  });
});

describe("suggested target", () => {
  it("offers the next round number above what is written", () => {
    expect(suggestedWordGoal(0)).toBe(1_000);
    expect(suggestedWordGoal(1_000)).toBe(2_500);
    expect(suggestedWordGoal(32_000)).toBe(50_000);
    expect(suggestedWordGoal(100_000)).toBe(150_000);
  });
});
