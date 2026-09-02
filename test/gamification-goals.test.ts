import { describe, expect, it } from "vitest";
import {
  parseGoalsPatch,
  validateMergedGoals,
  DEFAULT_GOALS,
  isScheduledDate,
  type GoalsView,
} from "@/lib/gamification/goals";

describe("goal PATCH validation", () => {
  it("rejects a non-object body", () => {
    expect(parseGoalsPatch(null)).toEqual({ error: "Send a JSON object of goal fields." });
    expect(parseGoalsPatch("nope")).toMatchObject({ error: expect.any(String) });
  });

  it("rejects an empty patch", () => {
    expect(parseGoalsPatch({})).toEqual({ error: "No goal fields to update." });
  });

  it("rejects a non-positive daily prose target", () => {
    expect(parseGoalsPatch({ dailyProseTarget: 0 })).toMatchObject({
      error: expect.stringMatching(/between 1 and/),
    });
    expect(parseGoalsPatch({ dailyProseTarget: 1.5 })).toMatchObject({
      error: expect.stringMatching(/whole number/),
    });
  });

  it("rejects an unknown reminder cadence", () => {
    expect(parseGoalsPatch({ reminderCadence: "forest" })).toMatchObject({
      error: expect.stringMatching(/daily, weekdays, every_n, or custom/),
    });
  });

  it("requires N when cadence is every_n (on merge)", () => {
    const merged: GoalsView = {
      ...DEFAULT_GOALS,
      timezone: "UTC",
      reminderCadence: "every_n",
      reminderEveryNDays: null,
    };
    expect(validateMergedGoals(merged)?.error).toMatch(/Every-N-days/);
  });

  it("requires at least one weekday for a custom cadence", () => {
    expect(parseGoalsPatch({ reminderCadence: "custom", reminderWeekdays: [] })).toMatchObject({
      error: expect.stringMatching(/at least one weekday/),
    });
    expect(parseGoalsPatch({ reminderWeekdays: [7] })).toMatchObject({
      error: expect.stringMatching(/0 \(Sunday\) to 6/),
    });
  });

  it("rejects a bad timezone and bad quiet hours", () => {
    expect(parseGoalsPatch({ timezone: "Not/A_Zone" })).toMatchObject({
      error: expect.stringMatching(/IANA/),
    });
    expect(parseGoalsPatch({ quietHoursStart: "9pm" })).toMatchObject({
      error: expect.stringMatching(/HH:MM/),
    });
  });

  it("accepts a valid partial patch and unique-sorts weekdays", () => {
    const parsed = parseGoalsPatch({
      dailyProseTarget: 750,
      reminderCadence: "custom",
      reminderWeekdays: [3, 1, 1, 5],
      timezone: "America/New_York",
      sessionMinutesTarget: 25,
    });
    expect(parsed).toEqual({
      dailyProseTarget: 750,
      reminderCadence: "custom",
      reminderWeekdays: [1, 3, 5],
      timezone: "America/New_York",
      sessionMinutesTarget: 25,
    });
  });

  it("allows clearing optional fields with null", () => {
    expect(parseGoalsPatch({ sessionMinutesTarget: null, pauseUntil: null })).toEqual({
      sessionMinutesTarget: null,
      pauseUntil: null,
    });
  });
});

describe("schedule-aware days", () => {
  it("treats weekends as rest on a weekdays cadence", () => {
    const prefs = {
      reminderCadence: "weekdays",
      reminderEveryNDays: null,
      reminderWeekdays: [],
    };
    // 2026-09-05 is Saturday, 2026-09-07 is Monday.
    expect(isScheduledDate("2026-09-05", prefs, "UTC")).toBe(false);
    expect(isScheduledDate("2026-09-07", prefs, "UTC")).toBe(true);
  });
});
