import { addChips, answersSummary, chipsBefore, reminderChipLabel, type StoryChip } from "../lib/onboarding-story";
import { onboardingReminderDraft } from "../lib/onboarding-flow";

const kind: StoryChip = { id: "kind", step: "goal", label: "Novel" };
const zone: StoryChip = { id: "obstacle:zone", step: "obstacle", label: "Staying in the zone" };
const time: StoryChip = { id: "obstacle:consistency", step: "obstacle", label: "Sitting down consistently" };
const theme: StoryChip = { id: "theme", step: "look", label: "Parchment" };

describe("onboarding story chips", () => {
  it("adds chips after the ones already there, in the order given", () => {
    expect(addChips([kind], [zone, time]).map((chip) => chip.id)).toEqual(["kind", "obstacle:zone", "obstacle:consistency"]);
  });

  it("replaces a chip answered again instead of doubling it", () => {
    const again = { ...kind, label: "Screenplay" };
    expect(addChips([kind, zone], [again])).toEqual([again, zone]);
  });

  it("takes back a step's answers, and every later step's, when it is shown again", () => {
    const all = [kind, zone, time, theme];
    expect(chipsBefore(all, "goal")).toEqual([]);
    expect(chipsBefore(all, "obstacle")).toEqual([kind]);
    expect(chipsBefore(all, "look")).toEqual([kind, zone, time]);
    expect(chipsBefore(all, "demo")).toEqual(all);
  });

  it("reads the whole row as one summary, and nothing while it is empty", () => {
    const format = (answers: string) => `Your answers: ${answers}`;
    expect(answersSummary([], format)).toBeNull();
    expect(answersSummary([kind, time], format)).toBe("Your answers: Novel, Sitting down consistently");
  });

  it("names the reminder by its days and time", () => {
    const translate = (key: string) => (key === "reminders.everyDay" ? "Every day" : key);
    expect(reminderChipLabel(onboardingReminderDraft("wr_x"), "en", translate)).toBe("Every day, 8:00 PM");
  });
});
