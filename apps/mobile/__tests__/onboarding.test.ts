import {
  demoForAnswers,
  isObstacle,
  OBSTACLES,
  parseObstacles,
  toggleObstacle,
  wantsReminderStep,
} from "../lib/onboarding";

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
    expect(demoForAnswers("novel", ["zone"])).toBe("focus_typewriter");
    expect(demoForAnswers("novel", ["consistency"])).toBe("focus_typewriter");
    expect(demoForAnswers("novel", ["unsure"])).toBe("focus_typewriter");
  });

  it("routes self-criticism, creativity, and writer's block to Suggestions", () => {
    expect(demoForAnswers("novel", ["self_criticism"])).toBe("suggestions_not_overwrites");
    expect(demoForAnswers("novel", ["creativity"])).toBe("suggestions_not_overwrites");
    expect(demoForAnswers("novel", ["block"])).toBe("suggestions_not_overwrites");
  });

  it("maps every obstacle to one of the two shipped demos", () => {
    for (const obstacle of OBSTACLES) {
      expect(["focus_typewriter", "suggestions_not_overwrites"]).toContain(demoForAnswers("novel", [obstacle]));
    }
  });

  it("never shows a journal invented prose, whatever the obstacle", () => {
    for (const obstacle of OBSTACLES) expect(demoForAnswers("journal", [obstacle])).toBe("focus_typewriter");
  });
});

describe("several obstacles", () => {
  it("opens the demo most of them point at", () => {
    expect(demoForAnswers("novel", ["zone", "block", "creativity"])).toBe("suggestions_not_overwrites");
    expect(demoForAnswers("novel", ["block", "zone", "consistency"])).toBe("focus_typewriter");
  });

  it("breaks a tie toward whichever was tapped first", () => {
    expect(demoForAnswers("novel", ["block", "zone"])).toBe("suggestions_not_overwrites");
    expect(demoForAnswers("novel", ["zone", "block"])).toBe("focus_typewriter");
  });

  it("opens Focus when nothing was picked, and for a journal whatever was", () => {
    expect(demoForAnswers("novel", [])).toBe("focus_typewriter");
    expect(demoForAnswers("journal", ["block", "creativity"])).toBe("focus_typewriter");
  });
});

describe("toggleObstacle", () => {
  it("adds and removes in tap order", () => {
    expect(toggleObstacle(["zone"], "block")).toEqual(["zone", "block"]);
    expect(toggleObstacle(["zone", "block"], "zone")).toEqual(["block"]);
  });

  it("keeps 'not sure' on its own", () => {
    expect(toggleObstacle(["zone", "block"], "unsure")).toEqual(["unsure"]);
    expect(toggleObstacle(["unsure"], "block")).toEqual(["block"]);
  });
});

describe("parseObstacles", () => {
  it("drops unknown and repeated ids and keeps order", () => {
    expect(parseObstacles("block,nope,zone,block")).toEqual(["block", "zone"]);
    expect(parseObstacles(undefined)).toEqual([]);
    expect(parseObstacles("")).toEqual([]);
  });

  it("never lets 'not sure' ride along with real answers", () => {
    expect(parseObstacles("unsure,block")).toEqual(["block"]);
  });
});

describe("wantsReminderStep", () => {
  it("is true only when consistency is among the picks", () => {
    expect(wantsReminderStep(["block", "consistency"])).toBe(true);
    expect(wantsReminderStep(["block"])).toBe(false);
    expect(wantsReminderStep([])).toBe(false);
  });
});
