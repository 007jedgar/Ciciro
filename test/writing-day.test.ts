import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
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
  parseWritingDayPut,
  parseWritingDayRange,
  summarizeWritingHistory,
  wordsInRollingWindow,
  PAUSE_MS,
} from "@/lib/writing-day";
import { getWritingDay, getWritingDays, putWritingDay } from "@/lib/writing-day-store";

describe("writing day", () => {
  it("merges two heartbeats on the same date", () => {
    const merged = mergeWritingDay({ words: 12, activeMs: 4_000 }, { words: 8, activeMs: 2_500 });
    expect(merged).toEqual({ words: 20, activeMs: 6_500 });
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
  });

  it("rejects a malformed heartbeat", () => {
    expect(parseWritingDayPut({ date: "12-09-2026", words: 1, activeMs: 1 })).toEqual({
      error: "date must be YYYY-MM-DD.",
    });
    expect(parseWritingDayPut({ date: "2026-09-12", words: -1, activeMs: 0 })).toEqual({
      error: "words must be a non-negative integer.",
    });
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
    const overlaid = overlayWritingDay(sample, {
      date: "2026-09-12",
      words: 55,
      activeMs: 45_000,
    });
    expect(overlaid.find((d) => d.date === "2026-09-12")).toEqual({
      date: "2026-09-12",
      words: 55,
      activeMs: 45_000,
    });
    expect(overlayWritingDay(sample, { date: "2026-09-15", words: 10, activeMs: 1_000 }).at(-1)).toEqual({
      date: "2026-09-15",
      words: 10,
      activeMs: 1_000,
    });
  });

  it("sums week and month windows and finds the best day", () => {
    expect(wordsInRollingWindow(sample, "2026-09-14", 7)).toBe(390);
    expect(bestWritingDay(sample)).toEqual({ date: "2026-09-10", words: 250, activeMs: 120_000 });
    expect(averageActiveMsPerWritingDay(sample)).toBe(70_000);
    expect(formatActiveDuration(70_000)).toBe("1 min");
  });

  it("counts writing days in the last seven including today", () => {
    // 8, 10, 12 have words; 14 has zero words; 9/11/13 missing.
    expect(countWritingDaysInWindow(sample, "2026-09-14", 7)).toBe(3);
    expect(countWritingDaysInWindow(sample, "2026-09-10", 7)).toBe(2);
  });

  it("summarizes history totals from the same rows", () => {
    expect(summarizeWritingHistory(sample, "2026-09-14")).toEqual({
      weekWords: 390,
      monthWords: 390,
      allTimeWords: 390,
      bestDay: { date: "2026-09-10", words: 250, activeMs: 120_000 },
      daysInLast7: 3,
      avgActiveMs: 70_000,
    });
  });

  it("rejects a backwards or oversized range", () => {
    expect(parseWritingDayRange("2026-09-14", "2026-09-10")).toEqual({
      error: "from must be on or before to.",
    });
    expect(parseWritingDayRange("bad", "2026-09-10")).toEqual({
      error: "from must be YYYY-MM-DD.",
    });
  });
  it("clamps the weekly day target into 1–7", () => {
    expect(clampWeeklyDayTarget(4)).toBe(4);
    expect(clampWeeklyDayTarget(0)).toBe(1);
    expect(clampWeeklyDayTarget(9)).toBe(7);
    expect(clampWeeklyDayTarget(Number.NaN)).toBe(DEFAULT_WEEKLY_DAY_TARGET);
  });
});

describe("writing day persistence", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.writingDay.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("adds a second heartbeat on the same date into one row", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const first = await putWritingDay(ada, { date: "2026-09-12", words: 40, activeMs: 5_000 });
    const second = await putWritingDay(ada, { date: "2026-09-12", words: 12, activeMs: 2_000 });
    expect(first).toMatchObject({ date: "2026-09-12", words: 40, activeMs: 5_000 });
    expect(second).toMatchObject({ date: "2026-09-12", words: 52, activeMs: 7_000 });
    expect(await getWritingDay(ada, "2026-09-12")).toMatchObject({
      date: "2026-09-12",
      words: 52,
      activeMs: 7_000,
    });
    expect(await prisma.writingDay.count({ where: { userId: ada.id } })).toBe(1);
  });

  it("reads a date range and skips empty days", async () => {
    const ada = await registerUser({
      email: "ada-range@example.com",
      password: "long-enough-pw",
    });
    await putWritingDay(ada, { date: "2026-09-10", words: 20, activeMs: 1_000 });
    await putWritingDay(ada, { date: "2026-09-12", words: 30, activeMs: 2_000 });
    const days = await getWritingDays(ada, "2026-09-10", "2026-09-12");
    expect(days.map((d) => ({ date: d.date, words: d.words }))).toEqual([
      { date: "2026-09-10", words: 20 },
      { date: "2026-09-12", words: 30 },
    ]);
  });
});
