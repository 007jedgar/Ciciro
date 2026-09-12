import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import {
  WritingDayAccumulator,
  activeMsForStroke,
  mergeWritingDay,
  parseWritingDayPut,
  PAUSE_MS,
} from "@/lib/writing-day";
import { getWritingDay, putWritingDay } from "@/lib/writing-day-store";

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

  it("rejects a malformed heartbeat", () => {
    expect(parseWritingDayPut({ date: "12-09-2026", words: 1, activeMs: 1 })).toEqual({
      error: "date must be YYYY-MM-DD.",
    });
    expect(parseWritingDayPut({ date: "2026-09-12", words: -1, activeMs: 0 })).toEqual({
      error: "words must be a non-negative integer.",
    });
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
});
