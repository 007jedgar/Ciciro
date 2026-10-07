const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));

import { getOnboardingAnswers, saveOnboardingAnswers } from "../lib/onboarding-answers";

describe("onboarding answers", () => {
  beforeEach(() => mockDisk.clear());

  it("has nothing before signup ever saves anything", () => {
    expect(getOnboardingAnswers()).toEqual({ kind: null, obstacle: null });
  });

  it("remembers both answers once saved, surviving an app restart", () => {
    saveOnboardingAnswers("journal", "self_criticism");
    expect(getOnboardingAnswers()).toEqual({ kind: "journal", obstacle: "self_criticism" });
  });

  it("reads back as unset if the stored value is no longer recognized", () => {
    mockDisk.set("onboarding-goal-kind", "short-story");
    mockDisk.set("onboarding-obstacle", "procrastination");
    expect(getOnboardingAnswers()).toEqual({ kind: null, obstacle: null });
  });
});
