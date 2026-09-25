import { manuscriptPace, nanoPreset } from "../lib/manuscript-target";

describe("manuscript pace", () => {
  it("ceil-divides remaining words by inclusive days left", () => {
    expect(manuscriptPace({ wordGoal: 1000, deadline: "2026-09-14" }, 100, "2026-09-12")).toMatchObject({
      remaining: 900,
      daysLeft: 3,
      pace: 300,
    });
  });

  it("does not inflate pace past the deadline", () => {
    expect(manuscriptPace({ wordGoal: 1000, deadline: "2026-09-10" }, 400, "2026-09-12").pace).toBeNull();
  });

  it("uses this November for NaNo when still ahead", () => {
    expect(nanoPreset("2026-09-12").deadline).toBe("2026-11-30");
  });
});
