import {
  formatSprintClock,
  getActiveSprint,
  setActiveSprint,
  sprintEndsAt,
  sprintHref,
  sprintRemainingMs,
  sprintWordsWritten,
} from "../lib/writing-sprint";

describe("writing sprint", () => {
  it("counts only positive word deltas for the sprint", () => {
    expect(sprintWordsWritten(100, 140)).toBe(40);
    expect(sprintWordsWritten(140, 100)).toBe(0);
  });

  it("formats the remaining clock and ends at the duration", () => {
    expect(formatSprintClock(65_000)).toBe("1:05");
    expect(formatSprintClock(0)).toBe("0:00");
    expect(sprintEndsAt(1_000, 15)).toBe(1_000 + 15 * 60_000);
    expect(sprintRemainingMs(5_000, 4_000)).toBe(1_000);
    expect(sprintRemainingMs(5_000, 6_000)).toBe(0);
    expect(sprintHref("p1")).toBe("/project/p1/sprint");
  });

  it("holds one active sprint for the write screen to resume", () => {
    setActiveSprint(null);
    expect(getActiveSprint()).toBeNull();
    setActiveSprint({
      projectId: "p1",
      durationMin: 15,
      startedAt: 1_000,
      endsAt: 1_000 + 15 * 60_000,
      startWords: 10,
    });
    expect(getActiveSprint()?.projectId).toBe("p1");
    setActiveSprint(null);
  });
});
