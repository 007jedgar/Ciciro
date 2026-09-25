import {
  averageSittingDurationMs,
  medianSittingStartHour,
  SITTING_IDLE_MS,
  WritingSessionTracker,
} from "../lib/writing-session";

describe("writing session tracker", () => {
  it("starts a sitting on the first stroke and closes after five idle minutes", () => {
    const tracker = new WritingSessionTracker(SITTING_IDLE_MS);
    expect(tracker.noteStroke(1_000)).toBeNull();
    tracker.noteWords(12, 2_000);
    const closed = tracker.noteStroke(2_000 + SITTING_IDLE_MS + 1);
    expect(closed).toMatchObject({
      startedAt: 1_000,
      endedAt: 2_000 + SITTING_IDLE_MS,
      words: 12,
    });
  });

  it("averages sitting length and median start hour", () => {
    const sessions = [
      { projectId: null, startedAt: Date.parse("2026-09-10T09:00:00"), endedAt: Date.parse("2026-09-10T09:20:00"), words: 1, activeMs: 1 },
      { projectId: null, startedAt: Date.parse("2026-09-11T21:00:00"), endedAt: Date.parse("2026-09-11T21:10:00"), words: 1, activeMs: 1 },
      { projectId: null, startedAt: Date.parse("2026-09-12T21:30:00"), endedAt: Date.parse("2026-09-12T21:50:00"), words: 1, activeMs: 1 },
    ];
    expect(averageSittingDurationMs(sessions)).toBe(Math.round((20 + 10 + 20) * 60_000 / 3));
    expect(medianSittingStartHour(sessions)).toBe(21);
  });
});
