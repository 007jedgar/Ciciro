import { onboardingParams, parseOnboardingParams, stepsFor, onboardingReminderDraft } from "../lib/onboarding-flow";

describe("onboarding flow params", () => {
  it("round-trips the answers through route params", () => {
    const reminder = onboardingReminderDraft("wr_test");
    const params = onboardingParams({
      kind: "journal",
      obstacles: ["block", "consistency"],
      reminder,
    });
    expect(params.obstacles).toBe("block,consistency");
    expect(parseOnboardingParams(params)).toEqual({
      kind: "journal",
      obstacles: ["block", "consistency"],
      reminder,
    });
  });

  it("drops anything unrecognized instead of carrying it to signup", () => {
    expect(
      parseOnboardingParams({ kind: "poem", obstacles: "block,procrastination,block", reminder: "{oops" })
    ).toEqual({ kind: "novel", obstacles: ["block"], reminder: null });
  });

  it("offers the reminder at eight in the evening, every day, for all manuscripts", () => {
    const draft = onboardingReminderDraft("wr_x");
    expect(draft).toMatchObject({ hour: 20, minute: 0, projectId: null, enabled: true });
    expect(draft.days).toHaveLength(7);
  });

  it("offers it with no word goal, and keeps that through the signup route params", () => {
    const draft = onboardingReminderDraft("wr_x");
    expect(draft.wordGoal).toBeNull();
    const back = parseOnboardingParams(onboardingParams({ kind: "novel", obstacles: ["consistency"], reminder: draft }));
    expect(back.reminder).toEqual(draft);
  });

  it("adds the reminder step only for the consistency obstacle", () => {
    expect(stepsFor(["block"])).toEqual(["goal", "obstacle", "look", "demo", "account"]);
    expect(stepsFor(["block", "consistency"])).toEqual(["goal", "obstacle", "look", "demo", "reminder", "account"]);
  });
});
