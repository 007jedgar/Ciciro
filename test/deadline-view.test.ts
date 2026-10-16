import { describe, expect, it } from "vitest";
import { deadlineSnapshot } from "@/lib/deadline-pace";
import {
  defaultDeadlineDraft,
  dueText,
  formatCount,
  parseWordTarget,
  progressText,
  statusText,
  verdictText,
} from "@/lib/deadline-view";

const TODAY = "2026-10-09";

function snap(over: Partial<Parameters<typeof deadlineSnapshot>[0]> = {}) {
  return deadlineSnapshot({
    wordGoal: 10_000,
    deadline: "2026-10-18",
    manuscriptWords: 4_000,
    days: [],
    today: TODAY,
    ...over,
  });
}

// The phone's copy (apps/mobile/lib/i18n/locales/en.ts, `deadline.*`) is the
// reference: the same snapshot reads the same on both, so these are the strings
// apps/mobile/__tests__/deadline-text.test.ts pins.
describe("deadline text", () => {
  it("says when it is due in plain days", () => {
    expect(dueText(snap({ deadline: TODAY }))).toBe("Due today");
    expect(dueText(snap({ deadline: "2026-10-10" }))).toBe("Due tomorrow");
    expect(dueText(snap({ deadline: "2026-10-11" }))).toBe("Due in 2 days");
    expect(dueText(snap({ deadline: "2026-10-19" }))).toBe("Due in 10 days");
    expect(dueText(snap({ deadline: "2026-10-08" }))).toBe("Due date passed");
  });

  it("states the daily words needed in every verdict that has a deadline ahead", () => {
    const days = [
      { date: "2026-10-08", words: 600 },
      { date: "2026-10-07", words: 600 },
    ];
    expect(verdictText(snap({ days }), "en")).toBe(
      "You are on track. You need about 600 words a day and you have been writing about 600."
    );
    expect(verdictText(snap({ days: days.map((d) => ({ ...d, words: 1_000 })) }), "en")).toBe(
      "You are comfortably ahead. You need about 600 words a day and you have been writing about 1,000."
    );
    expect(verdictText(snap({ days: days.map((d) => ({ ...d, words: 200 })) }), "en")).toBe(
      "A little more pace would help. To finish by the due date you need about 600 words a day, and lately it has been about 200."
    );
    expect(verdictText(snap(), "en")).toBe(
      "You need about 600 words a day to finish by the due date. Write for a few days and Ciciro can tell you how it is going."
    );
  });

  it("asks a writer who has stalled to pick up the pace", () => {
    expect(verdictText(snap({ days: [{ date: "2026-09-01", words: 900 }] }), "en")).toBe(
      "Time to pick up the pace. To finish by the due date you need about 600 words a day, and there has been little writing in the last two weeks."
    );
  });

  it("uses the singular for one word", () => {
    expect(verdictText(snap({ wordGoal: 4_001, deadline: TODAY }), "en")).toContain("about 1 word a day");
    expect(verdictText(snap({ wordGoal: 4_001, deadline: "2026-10-08" }), "en")).toBe(
      "The due date has passed with 1 word to go. Choose a new date whenever you like."
    );
    expect(verdictText(snap({ deadline: "2026-10-08" }), "en")).toBe(
      "The due date has passed with 6,000 words to go. Choose a new date whenever you like."
    );
  });

  it("congratulates a met target whatever the date", () => {
    expect(verdictText(snap({ manuscriptWords: 10_000 }), "en")).toBe("You reached your word target. Nicely done.");
    expect(verdictText(snap({ manuscriptWords: 12_000, deadline: "2026-10-01" }), "en")).toBe(
      "You reached your word target. Nicely done."
    );
  });

  it("names the status and the progress", () => {
    expect(statusText(snap({ manuscriptWords: 10_000 }))).toBe("Target reached");
    expect(statusText(snap({ deadline: "2026-10-08" }))).toBe("Date passed");
    expect(statusText(snap())).toBe("Just getting started");
    expect(progressText(snap(), "en")).toBe("4,000 of 10,000 words");
  });
});

describe("word target input", () => {
  it("reads a typed target the way writers type it", () => {
    expect(parseWordTarget("12000")).toBe(12_000);
    expect(parseWordTarget(" 12,000 ")).toBe(12_000);
    expect(parseWordTarget("12 000")).toBe(12_000);
    expect(parseWordTarget("12.000")).toBe(12_000);
  });

  it("rejects what is not a whole number of at least 1", () => {
    for (const text of ["", "0", "abc", "-5", "1e3", "99999999999999999999"]) {
      expect(parseWordTarget(text), text).toBeNull();
    }
  });

  it("starts a first deadline a month out", () => {
    expect(defaultDeadlineDraft(5_000, "2026-10-09")).toEqual({ goal: "5000", date: "2026-11-08" });
  });

  it("formats a count with grouping", () => {
    expect(formatCount(1500, "en")).toBe("1,500");
  });
});
