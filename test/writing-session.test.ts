import { describe, expect, it } from "vitest";
import {
  averageSittingDurationMs,
  medianSittingStartHour,
  SITTING_IDLE_MS,
  WritingSessionTracker,
} from "@/lib/writing-session";

describe("writing session tracker", () => {
  it("starts a sitting on the first stroke and closes after five idle minutes", () => {
    const tracker = new WritingSessionTracker(SITTING_IDLE_MS);
    expect(tracker.noteStroke(1_000)).toBeNull();
    expect(tracker.open?.startedAt).toBe(1_000);
    tracker.noteWords(12, 2_000);
    expect(tracker.open?.words).toBe(12);

    const closed = tracker.noteStroke(2_000 + SITTING_IDLE_MS + 1);
    expect(closed).toMatchObject({
      startedAt: 1_000,
      endedAt: 2_000 + SITTING_IDLE_MS,
      words: 12,
    });
    expect(tracker.open?.startedAt).toBe(2_000 + SITTING_IDLE_MS + 1);
  });

  it("force-closes an open sitting", () => {
    const tracker = new WritingSessionTracker();
    tracker.noteStroke(5_000);
    tracker.noteWords(40, 6_000);
    expect(tracker.close(7_000)).toMatchObject({
      startedAt: 5_000,
      endedAt: 7_000,
      words: 40,
    });
    expect(tracker.open).toBeNull();
  });
});

describe("writing session summaries", () => {
  const sessions = [
    { projectId: null, startedAt: Date.parse("2026-09-10T09:00:00"), endedAt: Date.parse("2026-09-10T09:20:00"), words: 100, activeMs: 10_000 },
    { projectId: null, startedAt: Date.parse("2026-09-11T21:00:00"), endedAt: Date.parse("2026-09-11T21:10:00"), words: 50, activeMs: 5_000 },
    { projectId: null, startedAt: Date.parse("2026-09-12T21:30:00"), endedAt: Date.parse("2026-09-12T21:50:00"), words: 80, activeMs: 8_000 },
  ];

  it("averages sitting duration", () => {
    // 20m + 10m + 20m = 50m / 3
    expect(averageSittingDurationMs(sessions)).toBe(Math.round((20 + 10 + 20) * 60_000 / 3));
  });

  it("returns the median start hour once enough sittings exist", () => {
    expect(medianSittingStartHour(sessions.slice(0, 2))).toBeNull();
    expect(medianSittingStartHour(sessions)).toBe(21);
  });
});
