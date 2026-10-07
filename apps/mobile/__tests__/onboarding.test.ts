import { demoForAnswers, isObstacle, OBSTACLES } from "../lib/onboarding";

describe("isObstacle", () => {
  it("accepts every listed obstacle and rejects anything else", () => {
    for (const obstacle of OBSTACLES) expect(isObstacle(obstacle)).toBe(true);
    expect(isObstacle("procrastination")).toBe(false);
    expect(isObstacle(undefined)).toBe(false);
    expect(isObstacle(42)).toBe(false);
  });
});

describe("demoForAnswers", () => {
  it("routes the universal, AI-free obstacles to Focus + Typewriter", () => {
    expect(demoForAnswers("novel", "zone")).toBe("focus_typewriter");
    expect(demoForAnswers("novel", "consistency")).toBe("focus_typewriter");
    expect(demoForAnswers("novel", "unsure")).toBe("focus_typewriter");
  });

  it("routes self-criticism, creativity, and writer's block to Suggestions", () => {
    expect(demoForAnswers("novel", "self_criticism")).toBe("suggestions_not_overwrites");
    expect(demoForAnswers("novel", "creativity")).toBe("suggestions_not_overwrites");
    expect(demoForAnswers("novel", "block")).toBe("suggestions_not_overwrites");
  });

  it("maps every obstacle to one of the two shipped demos", () => {
    for (const obstacle of OBSTACLES) {
      expect(["focus_typewriter", "suggestions_not_overwrites"]).toContain(demoForAnswers("novel", obstacle));
    }
  });

  it("never shows a journal invented prose, whatever the obstacle", () => {
    for (const obstacle of OBSTACLES) expect(demoForAnswers("journal", obstacle)).toBe("focus_typewriter");
  });
});
