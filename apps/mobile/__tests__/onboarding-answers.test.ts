const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
    remove: (key: string) => {
      mockDisk.delete(key);
    },
  }),
}));

import { getOnboardingAnswers, saveOnboardingAnswers } from "../lib/onboarding-answers";

describe("onboarding answers", () => {
  beforeEach(() => mockDisk.clear());

  it("has nothing before signup ever saves anything", () => {
    expect(getOnboardingAnswers()).toEqual({ kind: null, obstacles: [] });
  });

  it("remembers both answers once saved, surviving an app restart", () => {
    saveOnboardingAnswers("journal", ["self_criticism", "consistency"]);
    expect(getOnboardingAnswers()).toEqual({ kind: "journal", obstacles: ["self_criticism", "consistency"] });
  });

  it("keeps the goal when the obstacle question was skipped", () => {
    saveOnboardingAnswers("screenplay", []);
    expect(getOnboardingAnswers()).toEqual({ kind: "screenplay", obstacles: [] });
  });

  it("drops an earlier quiz's obstacle when this one skipped Q2", () => {
    saveOnboardingAnswers("novel", ["self_criticism"]);
    saveOnboardingAnswers("journal", []);
    expect(getOnboardingAnswers()).toEqual({ kind: "journal", obstacles: [] });
  });

  it("reads back as unset if the stored value is no longer recognized", () => {
    mockDisk.set("onboarding-goal-kind", "short-story");
    mockDisk.set("onboarding-obstacle", "procrastination");
    expect(getOnboardingAnswers()).toEqual({ kind: null, obstacles: [] });
  });

  it("still reads the single obstacle an earlier version stored", () => {
    mockDisk.set("onboarding-goal-kind", "novel");
    mockDisk.set("onboarding-obstacle", "block");
    expect(getOnboardingAnswers()).toEqual({ kind: "novel", obstacles: ["block"] });
  });
});
