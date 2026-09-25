import {
  WritingDayAccumulator,
  activeMsForStroke,
  averageActiveMsPerWritingDay,
  bestWritingDay,
  bucketWritingDays,
  clampWeeklyDayTarget,
  countWritingDaysInWindow,
  DEFAULT_WEEKLY_DAY_TARGET,
  formatActiveDuration,
  holdWritingDaySnapshot,
  mergeWritingDay,
  overlayWritingDay,
  summarizeWritingHistory,
  wordsInRollingWindow,
  PAUSE_MS,
} from "../lib/writing-day";
import { getWritingDaySnapshot, stopWritingDay } from "../lib/writing-day-session";

describe("writing day", () => {
  it("merges two heartbeats on the same date", () => {
    const merged = mergeWritingDay({ words: 12, activeMs: 4_000 }, { words: 8, activeMs: 2_500 });
    expect(merged).toEqual({ words: 20, activeMs: 6_500 });

    const acc = new WritingDayAccumulator(PAUSE_MS, 0);
    acc.noteWords(12, 0);
    acc.noteWords(8, 1_000);
    expect(acc.takePending()).toEqual({ date: acc.date, words: 20, activeMs: 1_000 });
  });

  it("does not add idle time after a pause longer than 30s", () => {
    const acc = new WritingDayAccumulator(PAUSE_MS, 0);
    acc.noteStroke(0);
    acc.noteStroke(8_000);
    acc.noteStroke(8_000 + PAUSE_MS + 1);
    expect(acc.snapshot().activeMs).toBe(8_000);
    expect(activeMsForStroke(0, PAUSE_MS + 1)).toBe(0);
    expect(activeMsForStroke(0, PAUSE_MS)).toBe(PAUSE_MS);
  });

  it("reuses the snapshot object when daily totals have not changed", () => {
    const held = { date: "2026-09-12", words: 10, activeMs: 4_000 };
    expect(holdWritingDaySnapshot(held, { date: "2026-09-12", words: 10, activeMs: 4_000 })).toBe(held);
    expect(holdWritingDaySnapshot(held, { date: "2026-09-12", words: 11, activeMs: 4_000 })).toEqual({
      date: "2026-09-12",
      words: 11,
      activeMs: 4_000,
    });
    stopWritingDay();
    expect(getWritingDaySnapshot()).toBe(getWritingDaySnapshot());
  });
});

describe("writing day history helpers", () => {
  const sample = [
    { date: "2026-09-08", words: 100, activeMs: 60_000 },
    { date: "2026-09-10", words: 250, activeMs: 120_000 },
    { date: "2026-09-12", words: 40, activeMs: 30_000 },
    { date: "2026-09-14", words: 0, activeMs: 5_000 },
  ];

  it("fills missing calendar days with zeros", () => {
    expect(bucketWritingDays(sample, "2026-09-10", "2026-09-12")).toEqual([
      { date: "2026-09-10", words: 250, activeMs: 120_000 },
      { date: "2026-09-11", words: 0, activeMs: 0 },
      { date: "2026-09-12", words: 40, activeMs: 30_000 },
    ]);
  });

  it("overlays today's pending heartbeat onto the range", () => {
    expect(
      overlayWritingDay(sample, { date: "2026-09-12", words: 55, activeMs: 45_000 }).find(
        (d) => d.date === "2026-09-12"
      )
    ).toEqual({ date: "2026-09-12", words: 55, activeMs: 45_000 });
  });

  it("sums windows, best day, average active time, and the 7-day count", () => {
    expect(wordsInRollingWindow(sample, "2026-09-14", 7)).toBe(390);
    expect(bestWritingDay(sample)).toEqual({ date: "2026-09-10", words: 250, activeMs: 120_000 });
    expect(averageActiveMsPerWritingDay(sample)).toBe(70_000);
    expect(formatActiveDuration(125_000)).toBe("2 min");
    expect(countWritingDaysInWindow(sample, "2026-09-14", 7)).toBe(3);
    expect(summarizeWritingHistory(sample, "2026-09-14").daysInLast7).toBe(3);
    expect(clampWeeklyDayTarget(9)).toBe(7);
    expect(clampWeeklyDayTarget(0)).toBe(1);
    expect(clampWeeklyDayTarget(Number.NaN)).toBe(DEFAULT_WEEKLY_DAY_TARGET);
  });
});
