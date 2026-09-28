import { describe, expect, it } from "vitest";
import {
  buildContinuityInput,
  groundFindings,
  MAX_BIBLE_CHARS,
  MAX_CHAPTER_CHARS,
  parseContinuityFindings,
  relevantCharacterPaths,
} from "@/lib/continuity-view";

describe("relevantCharacterPaths", () => {
  const index = [
    { path: "canon.md", summary: "Canon" },
    { path: "characters/aiden-cross.md", summary: "Aiden Cross" },
    { path: "characters/mara.md", summary: "Mara - the narrator's sister" },
    { path: "characters/old-nickname.md", summary: "Jonah" },
  ];

  it("includes a character file only when its name is mentioned in the chapter", () => {
    const text = "Aiden crossed the yard while Mara watched from the porch.";
    expect(relevantCharacterPaths(index, text)).toEqual([
      "characters/aiden-cross.md",
      "characters/mara.md",
    ]);
  });

  it("excludes characters the chapter never names", () => {
    const text = "The house was quiet, and nobody else was mentioned at all.";
    expect(relevantCharacterPaths(index, text)).toEqual([]);
  });

  it("matches on a whole word, not a substring of a longer word", () => {
    const text = "Marathon runners filled the street.";
    // "Mara" is a substring of "Marathon" but not the same word.
    expect(relevantCharacterPaths(index, text)).toEqual([]);
  });

  it("falls back to the index summary when the slug doesn't carry the name", () => {
    const text = "Jonah hadn't been called that in years.";
    expect(relevantCharacterPaths(index, text)).toEqual(["characters/old-nickname.md"]);
  });

  it("is case-insensitive", () => {
    expect(relevantCharacterPaths(index, "AIDEN showed up late.")).toEqual(["characters/aiden-cross.md"]);
  });
});

describe("buildContinuityInput", () => {
  it("lists non-empty bible sections before the chapter, and drops empty ones", () => {
    const input = buildContinuityInput(
      [
        { path: "canon.md", content: "- POV: close third" },
        { path: "world.md", content: "" },
        { path: "characters/aiden.md", content: "Blue eyes." },
      ],
      "Chapter One",
      "Aiden's eyes were brown."
    );
    expect(input).toContain("## canon.md\n- POV: close third");
    expect(input).toContain("## characters/aiden.md\nBlue eyes.");
    expect(input).not.toContain("## world.md");
    expect(input).toContain("# Chapter: Chapter One");
    expect(input).toContain("Aiden's eyes were brown.");
    // canon.md must come before the chapter in the assembled prompt.
    expect(input.indexOf("## canon.md")).toBeLessThan(input.indexOf("# Chapter: Chapter One"));
  });

  it("says so when there are no bible facts on file yet", () => {
    const input = buildContinuityInput([], "Chapter One", "Text.");
    expect(input).toContain("(no bible facts on file yet)");
  });

  it("bounds each bible section and the chapter text so cost cannot grow unbounded", () => {
    const longBible = "x".repeat(MAX_BIBLE_CHARS + 500);
    const longChapter = "y".repeat(MAX_CHAPTER_CHARS + 500);
    const input = buildContinuityInput([{ path: "canon.md", content: longBible }], "Ch", longChapter);
    expect(input).toContain("x".repeat(MAX_BIBLE_CHARS));
    expect(input).not.toContain("x".repeat(MAX_BIBLE_CHARS + 1));
    expect(input).toContain("y".repeat(MAX_CHAPTER_CHARS));
    expect(input).not.toContain("y".repeat(MAX_CHAPTER_CHARS + 1));
  });
});

describe("parseContinuityFindings", () => {
  const finding = {
    chapterQuote: "Her eyes were brown in the lamplight.",
    canonFile: "characters/mara.md",
    canonQuote: "Mara has green eyes.",
    note: "Eye color contradicts the character file.",
  };

  it("parses a plain JSON array", () => {
    expect(parseContinuityFindings(JSON.stringify([finding]))).toEqual([finding]);
  });

  it("tolerates a fenced code block and stray prose", () => {
    expect(parseContinuityFindings("```json\n" + JSON.stringify([finding]) + "\n```")).toEqual([finding]);
    expect(parseContinuityFindings("Here it is: " + JSON.stringify([finding]))).toEqual([finding]);
  });

  it("returns an empty list for [], prose with no array, or malformed JSON", () => {
    expect(parseContinuityFindings("[]")).toEqual([]);
    expect(parseContinuityFindings("Nothing contradicts the bible.")).toEqual([]);
    expect(parseContinuityFindings("[{broken")).toEqual([]);
  });

  it("drops findings missing a required field or naming an unknown bible file", () => {
    const findings = parseContinuityFindings(
      JSON.stringify([
        finding,
        { ...finding, chapterQuote: "" },
        { ...finding, canonFile: "" },
        { ...finding, canonFile: "notes.md" },
        { chapterQuote: "only this" },
      ])
    );
    expect(findings).toEqual([finding]);
  });

  it("accepts every known bible file shape", () => {
    for (const canonFile of ["canon.md", "world.md", "timeline.md", "characters/aiden.md"]) {
      expect(parseContinuityFindings(JSON.stringify([{ ...finding, canonFile }]))).toHaveLength(1);
    }
  });

  it("trims quotes and notes and caps the number of findings", () => {
    const padded = { ...finding, chapterQuote: `  ${finding.chapterQuote}  ` };
    expect(parseContinuityFindings(JSON.stringify([padded]))[0].chapterQuote).toBe(finding.chapterQuote);

    const many = Array.from({ length: 30 }, (_, i) => ({ ...finding, note: `#${i}` }));
    expect(parseContinuityFindings(JSON.stringify(many)).length).toBeLessThanOrEqual(20);
  });
});

describe("groundFindings", () => {
  const bible = [{ path: "characters/mara.md", content: "# Mara\nMara has green eyes." }];
  const chapterText = "Mara stepped off the train. Her eyes were brown in the lamplight.";
  const finding = {
    chapterQuote: "Her eyes were brown in the lamplight.",
    canonFile: "characters/mara.md",
    canonQuote: "Mara has green eyes.",
    note: "Eye color contradicts the character file.",
  };

  it("keeps a finding whose quotes are verbatim substrings of the given text", () => {
    expect(groundFindings([finding], chapterText, bible)).toEqual([finding]);
  });

  it("is case-insensitive, since Show in text matches case-insensitively too", () => {
    const upper = { ...finding, chapterQuote: finding.chapterQuote.toUpperCase() };
    expect(groundFindings([upper], chapterText, bible)).toEqual([upper]);
  });

  it("drops a finding whose chapter quote was paraphrased or is missing", () => {
    const paraphrased = { ...finding, chapterQuote: "Her eyes looked brown." };
    expect(groundFindings([paraphrased], chapterText, bible)).toEqual([]);
  });

  it("drops a finding whose canon quote isn't actually in the named bible file", () => {
    const wrong = { ...finding, canonQuote: "Mara has blue eyes." };
    expect(groundFindings([wrong], chapterText, bible)).toEqual([]);
  });

  it("drops a finding that names a bible file that wasn't sent", () => {
    const wrongFile = { ...finding, canonFile: "world.md" };
    expect(groundFindings([wrongFile], chapterText, bible)).toEqual([]);
  });
});
