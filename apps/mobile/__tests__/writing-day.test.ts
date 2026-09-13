import {
  WritingDayAccumulator,
  activeMsForStroke,
  holdWritingDaySnapshot,
  mergeWritingDay,
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
