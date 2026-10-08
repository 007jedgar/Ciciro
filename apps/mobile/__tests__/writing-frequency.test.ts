import {
  COUNT_SLOT,
  PERIOD_SLOT,
  countWritingFrequency,
  frequencyEntries,
  splitSentence,
  startOfWritingWeek,
  typewriterSteps,
} from "../lib/writing-frequency";

const day = (date: string, words = 100) => ({ date, words });

describe("startOfWritingWeek", () => {
  it("runs Monday to Sunday", () => {
    expect(startOfWritingWeek("2026-10-07")).toBe("2026-10-05"); // a Wednesday
    expect(startOfWritingWeek("2026-10-05")).toBe("2026-10-05"); // the Monday itself
    expect(startOfWritingWeek("2026-10-11")).toBe("2026-10-05"); // the Sunday closing that week
    expect(startOfWritingWeek("2026-10-01")).toBe("2026-09-28"); // across a month boundary
  });
});

describe("countWritingFrequency", () => {
  it("counts days with words in the current calendar week, month and year", () => {
    const days = [
      day("2026-01-02"),
      day("2026-09-30"),
      day("2026-10-01"),
      day("2026-10-02"),
      day("2026-10-05"),
      day("2026-10-07"),
      day("2026-10-06", 0),
    ];
    expect(countWritingFrequency(days, "2026-10-07")).toEqual({ week: 2, month: 4, year: 6 });
  });

  it("ignores days after today", () => {
    expect(countWritingFrequency([day("2026-10-07"), day("2026-10-09")], "2026-10-07").week).toBe(1);
  });

  it("is all zero when nothing was written, and never counts a streak", () => {
    expect(countWritingFrequency([], "2026-10-07")).toEqual({ week: 0, month: 0, year: 0 });
    // Writing on the 1st and the 7th is two times, not "a run of anything".
    expect(countWritingFrequency([day("2026-10-01"), day("2026-10-07")], "2026-10-07").month).toBe(2);
  });
});

describe("frequencyEntries", () => {
  it("skips a period with nothing in it", () => {
    expect(frequencyEntries({ week: 0, month: 3, year: 9 })).toEqual([
      { period: "month", count: 3 },
      { period: "year", count: 9 },
    ]);
    expect(frequencyEntries({ week: 0, month: 0, year: 0 })).toEqual([]);
    expect(frequencyEntries({ week: 1, month: 1, year: 1 }).map((e) => e.period)).toEqual(["week", "month", "year"]);
  });
});

describe("splitSentence", () => {
  it("keeps the slots in the order the language puts them", () => {
    expect(splitSentence(`You've written ${COUNT_SLOT} ${PERIOD_SLOT}`)).toEqual([
      { kind: "text", text: "You've written " },
      { kind: "count", text: "" },
      { kind: "text", text: " " },
      { kind: "period", text: "" },
    ]);
    expect(splitSentence(`${PERIOD_SLOT}你写了${COUNT_SLOT}`).map((p) => p.kind)).toEqual(["period", "text", "count"]);
  });
});

describe("typewriterSteps", () => {
  it("deletes at 26ms a letter, pauses, then types at 42ms a letter", () => {
    const steps = typewriterSteps("ab", "xyz");
    expect(steps.map((s) => s.text)).toEqual(["a", "", "x", "xy", "xyz"]);
    expect(steps.map((s) => s.delayMs)).toEqual([26, 26, 90, 42, 42]);
  });

  it("does nothing when the text is unchanged", () => {
    expect(typewriterSteps("twice", "twice")).toEqual([]);
  });
});
