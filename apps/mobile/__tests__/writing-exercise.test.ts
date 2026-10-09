import {
  EXERCISE_PARTS,
  PART_MINUTES,
  PART_MS,
  SETTLE_MS,
  SETTLE_PROMPTS,
  SETTLE_PROMPT_MS,
  exerciseCopyText,
  exerciseHtml,
  exerciseWordCount,
  fractionOf,
  hasWriting,
  nextPart,
  partsBefore,
  settlePromptAt,
  totalWords,
} from "../lib/writing-exercise";

const labels = { observe: "Noticed", react: "Felt", narrate: "Story" };

describe("writing exercise clocks", () => {
  it("settles in for 30 to 60 seconds and gives each writing part five to ten minutes", () => {
    expect(SETTLE_MS).toBeGreaterThanOrEqual(30_000);
    expect(SETTLE_MS).toBeLessThanOrEqual(60_000);
    expect(PART_MINUTES).toBeGreaterThanOrEqual(5);
    expect(PART_MINUTES).toBeLessThanOrEqual(10);
    expect(PART_MS).toBe(PART_MINUTES * 60_000);
  });

  it("walks the senses in order and holds the last one to the end", () => {
    expect(SETTLE_PROMPTS).toEqual(["look", "listen", "smell", "feel"]);
    expect(settlePromptAt(0)).toBe("look");
    expect(settlePromptAt(SETTLE_PROMPT_MS - 1)).toBe("look");
    expect(settlePromptAt(SETTLE_PROMPT_MS)).toBe("listen");
    expect(settlePromptAt(SETTLE_PROMPT_MS * 3)).toBe("feel");
    expect(settlePromptAt(SETTLE_MS * 2)).toBe("feel");
    expect(settlePromptAt(-5)).toBe("look");
  });

  it("clamps progress to the span", () => {
    expect(fractionOf(0, 1000)).toBe(0);
    expect(fractionOf(250, 1000)).toBe(0.25);
    expect(fractionOf(5000, 1000)).toBe(1);
    expect(fractionOf(-1, 1000)).toBe(0);
    expect(fractionOf(10, 0)).toBe(0);
    expect(fractionOf(Number.NaN, 1000)).toBe(0);
  });
});

describe("writing exercise parts", () => {
  it("runs observe, react, narrate", () => {
    expect(EXERCISE_PARTS).toEqual(["observe", "react", "narrate"]);
    expect(nextPart("observe")).toBe("react");
    expect(nextPart("react")).toBe("narrate");
    expect(nextPart("narrate")).toBeNull();
  });

  it("shows the parts before a part above its page", () => {
    expect(partsBefore("observe")).toEqual([]);
    expect(partsBefore("react")).toEqual(["observe"]);
    expect(partsBefore("narrate")).toEqual(["observe", "react"]);
  });
});

describe("writing exercise text", () => {
  const texts = { observe: "A grey cup.\nRain on glass.", react: "  Calm  ", narrate: "" };

  it("counts words and notices writing", () => {
    expect(exerciseWordCount("")).toBe(0);
    expect(exerciseWordCount("  one  two\nthree ")).toBe(3);
    expect(totalWords(texts)).toBe(7);
    expect(hasWriting(texts)).toBe(true);
    expect(hasWriting({ observe: "  ", react: "\n", narrate: "" })).toBe(false);
  });

  it("builds the chapter: a heading and paragraphs per part, escaped", () => {
    expect(exerciseHtml({ ...texts, narrate: "a < b & c" }, labels)).toBe(
      "<h2>Noticed</h2><p>A grey cup.</p><p>Rain on glass.</p><h2>Felt</h2><p>Calm</p><h2>Story</h2><p>a &lt; b &amp; c</p>"
    );
  });

  it("keeps an empty part as a bare heading", () => {
    expect(exerciseHtml({ observe: "", react: "", narrate: "" }, labels)).toBe(
      "<h2>Noticed</h2><h2>Felt</h2><h2>Story</h2>"
    );
  });

  it("builds the copied text with each part named", () => {
    expect(exerciseCopyText(texts, labels)).toBe("Noticed\n\nA grey cup.\n\nRain on glass.\n\n\nFelt\n\nCalm\n\n\nStory");
  });
});
