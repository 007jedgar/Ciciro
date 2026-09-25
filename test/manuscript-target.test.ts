import { describe, expect, it } from "vitest";
import { manuscriptPace, nanoPreset } from "@/lib/manuscript-target";

describe("manuscript pace", () => {
  it("ceil-divides remaining words by inclusive days left", () => {
    expect(manuscriptPace({ wordGoal: 1000, deadline: "2026-09-14" }, 100, "2026-09-12")).toEqual({
      remaining: 900,
      daysLeft: 3,
      pace: 300,
      pastDeadline: false,
      complete: false,
    });
  });

  it("stops inflating pace after the deadline", () => {
    expect(manuscriptPace({ wordGoal: 1000, deadline: "2026-09-10" }, 400, "2026-09-12")).toEqual({
      remaining: 600,
      daysLeft: 0,
      pace: null,
      pastDeadline: true,
      complete: false,
    });
  });

  it("marks the goal complete when words catch up", () => {
    expect(manuscriptPace({ wordGoal: 500, deadline: "2026-09-30" }, 500, "2026-09-12").complete).toBe(
      true
    );
  });

  it("picks this November for NaNo when still ahead", () => {
    expect(nanoPreset("2026-09-12")).toEqual({
      projectId: "",
      wordGoal: 50_000,
      deadline: "2026-11-30",
    });
    expect(nanoPreset("2026-12-01").deadline).toBe("2027-11-30");
  });
});
