import {
  ONBOARDING_STEPS,
  onboardingParams,
  onboardingReminderDraft,
  parseOnboardingParams,
  pathAfter,
  stepsFor,
} from "../lib/onboarding-flow";

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
    expect(stepsFor(["zone"])).toEqual(["goal", "obstacle", "look", "demo", "account"]);
    expect(stepsFor(["zone", "consistency"])).toEqual(["goal", "obstacle", "look", "demo", "reminder", "account"]);
  });

  it("adds the exercises step for creativity or writer's block, after the demo", () => {
    expect(stepsFor(["block"])).toEqual(["goal", "obstacle", "look", "demo", "exercises", "account"]);
    expect(stepsFor(["creativity"])).toEqual(["goal", "obstacle", "look", "demo", "exercises", "account"]);
    expect(stepsFor(["self_criticism", "unsure"])).toEqual(["goal", "obstacle", "look", "demo", "account"]);
    expect(stepsFor([])).toEqual(["goal", "obstacle", "look", "demo", "account"]);
  });

  it("puts the exercises step before the reminder step when both apply", () => {
    expect(stepsFor(["block", "consistency"])).toEqual([
      "goal",
      "obstacle",
      "look",
      "demo",
      "exercises",
      "reminder",
      "account",
    ]);
  });

  it("only ever drops steps from the one ordered list", () => {
    for (const obstacles of [[], ["zone"], ["block"], ["consistency"], ["creativity", "consistency"]] as const) {
      const steps = stepsFor(obstacles);
      expect(ONBOARDING_STEPS.filter((step) => steps.includes(step))).toEqual(steps);
    }
  });
});

describe("pathAfter", () => {
  it("sends the demo to signup unless an answer asks for another step", () => {
    expect(pathAfter("demo", [])).toBe("/signup");
    expect(pathAfter("demo", ["zone", "self_criticism"])).toBe("/signup");
  });

  it("sends the demo to the exercises for creativity and writer's block", () => {
    expect(pathAfter("demo", ["creativity"])).toBe("/onboarding/exercises");
    expect(pathAfter("demo", ["zone", "block"])).toBe("/onboarding/exercises");
  });

  it("sends the demo to the reminder form for consistency", () => {
    expect(pathAfter("demo", ["consistency"])).toBe("/onboarding/reminder");
  });

  it("walks exercises and then the reminder when both apply, and signup after the last", () => {
    expect(pathAfter("demo", ["block", "consistency"])).toBe("/onboarding/exercises");
    expect(pathAfter("exercises", ["block", "consistency"])).toBe("/onboarding/reminder");
    expect(pathAfter("exercises", ["block"])).toBe("/signup");
    expect(pathAfter("reminder", ["block", "consistency"])).toBe("/signup");
  });
});
