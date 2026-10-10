import i18n from "../lib/i18n";
import { deadlineSnapshot } from "../lib/deadline-pace";
import { dueText, formatCount, verdictText } from "../lib/deadline-text";

const t = i18n.t.bind(i18n);
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


describe("deadline text", () => {
  it("says when it is due in plain days", () => {
    expect(dueText(t, snap({ deadline: TODAY }))).toBe("Due today");
    expect(dueText(t, snap({ deadline: "2026-10-10" }))).toBe("Due tomorrow");
    expect(dueText(t, snap({ deadline: "2026-10-19" }))).toBe("Due in 10 days");
    expect(dueText(t, snap({ deadline: "2026-10-08" }))).toBe("Due date passed");
  });

  it("states the daily words needed in every verdict that has a deadline ahead", () => {
    const days = [
      { date: "2026-10-08", words: 600 },
      { date: "2026-10-07", words: 600 },
    ];
    expect(verdictText(t, snap({ days }), "en")).toBe(
      "You are on track. You need about 600 words a day and you have been writing about 600."
    );
    expect(verdictText(t, snap({ days: days.map((d) => ({ ...d, words: 1_000 })) }), "en")).toBe(
      "You are comfortably ahead. You need about 600 words a day and you have been writing about 1,000."
    );
    expect(verdictText(t, snap({ days: days.map((d) => ({ ...d, words: 200 })) }), "en")).toBe(
      "A little more pace would help. To finish by the due date you need about 600 words a day, and lately it has been about 200."
    );
    expect(verdictText(t, snap(), "en")).toContain("You need about 600 words a day");
  });

  it("asks a writer who has stalled to pick up the pace", () => {
    expect(verdictText(t, snap({ days: [{ date: "2026-09-01", words: 900 }] }), "en")).toBe(
      "Time to pick up the pace. To finish by the due date you need about 600 words a day, and there has been little writing in the last two weeks."
    );
  });

  it("is calm when the date has passed or the target is met", () => {
    expect(verdictText(t, snap({ deadline: "2026-10-08" }), "en")).toBe(
      "The due date has passed with 6,000 words to go. Choose a new date whenever you like."
    );
    expect(verdictText(t, snap({ manuscriptWords: 10_000 }), "en")).toBe(
      "You reached your word target. Nicely done."
    );
  });

  it("uses the singular for one word a day", () => {
    expect(verdictText(t, snap({ wordGoal: 4_001, deadline: TODAY }), "en")).toContain("about 1 word a day");
  });

  it("has a verdict in every language", async () => {
    for (const lang of ["es", "hi", "zh"]) {
      await i18n.changeLanguage(lang);
      const text = verdictText(t, snap({ days: [{ date: "2026-10-08", words: 200 }] }), lang);
      expect(text).toContain("600");
      expect(text).not.toContain("deadline.");
      const stalled = verdictText(t, snap({ days: [{ date: "2026-09-01", words: 900 }] }), lang);
      expect(stalled).toContain("600");
      expect(stalled).not.toContain("deadline.");
    }
  });

  it("formats counts for the reader's language", () => {
    expect(formatCount(1500, "en")).toBe("1,500");
  });
});
