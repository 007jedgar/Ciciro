import { demoForObstacle, isObstacle, OBSTACLES } from "../lib/onboarding";

describe("isObstacle", () => {
  it("accepts every listed obstacle and rejects anything else", () => {
    for (const obstacle of OBSTACLES) expect(isObstacle(obstacle)).toBe(true);
    expect(isObstacle("procrastination")).toBe(false);
    expect(isObstacle(undefined)).toBe(false);
    expect(isObstacle(42)).toBe(false);
  });
});

describe("demoForObstacle", () => {
  it("routes the universal, AI-free obstacles to Focus + Typewriter", () => {
    expect(demoForObstacle("zone")).toBe("focus_typewriter");
    expect(demoForObstacle("consistency")).toBe("focus_typewriter");
    expect(demoForObstacle("unsure")).toBe("focus_typewriter");
  });

  it("routes self-criticism, creativity, and writer's block to Suggestions", () => {
    expect(demoForObstacle("self_criticism")).toBe("suggestions_not_overwrites");
    expect(demoForObstacle("creativity")).toBe("suggestions_not_overwrites");
    expect(demoForObstacle("block")).toBe("suggestions_not_overwrites");
  });

  it("maps every obstacle to one of the two shipped demos", () => {
    for (const obstacle of OBSTACLES) {
      expect(["focus_typewriter", "suggestions_not_overwrites"]).toContain(demoForObstacle(obstacle));
    }
  });
});
