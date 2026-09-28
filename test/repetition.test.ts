import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  analyzeManuscriptRepetition,
  analyzeRepetitionText,
  buildExclusionSet,
  nameTokens,
} from "@/lib/repetition";

describe("analyzeRepetitionText - thresholds", () => {
  it("does not flag a word below the minimum count", () => {
    const text = "shimmer shimmer shimmer plain filler words all around the room today.";
    const report = analyzeRepetitionText(text, [], { ...DEFAULT_THRESHOLDS, minWordCount: 5, wordRatePer1000: 0 });
    expect(report.words.find((w) => w.text === "shimmer")).toBeUndefined();
  });

  it("flags a word once it reaches the minimum count", () => {
    const text = Array(5).fill("shimmer").join(" ") + " plain filler words around the room today.";
    const report = analyzeRepetitionText(text, [], { ...DEFAULT_THRESHOLDS, minWordCount: 5, wordRatePer1000: 0 });
    const flag = report.words.find((w) => w.text === "shimmer");
    expect(flag).toBeDefined();
    expect(flag!.count).toBe(5);
  });

  it("uses the higher of the absolute floor and the rate per 1,000 words", () => {
    // 2,000 words analyzed, held fixed; a rate of 4 per 1,000 sets the floor
    // at 8, above minWordCount, so 7 stays under it and 8 clears it.
    const build = (shimmerCount: number) =>
      `${Array(2000 - shimmerCount).fill("filler").join(" ")} ${Array(shimmerCount).fill("shimmer").join(" ")}`;
    const thresholds = { ...DEFAULT_THRESHOLDS, minWordCount: 5, wordRatePer1000: 4 };

    const below = analyzeRepetitionText(build(7), [], thresholds);
    expect(below.words.find((w) => w.text === "shimmer")).toBeUndefined();

    const at = analyzeRepetitionText(build(8), [], thresholds);
    expect(at.words.find((w) => w.text === "shimmer")?.count).toBe(8);
  });

  it("reports occurrences per 1,000 words", () => {
    const text = Array(10).fill("shimmer").join(" ") + " " + Array(990).fill("filler").join(" ");
    const report = analyzeRepetitionText(text, [], { ...DEFAULT_THRESHOLDS, minWordCount: 5, wordRatePer1000: 0 });
    const flag = report.words.find((w) => w.text === "shimmer");
    expect(flag?.perThousand).toBe(10);
  });
});

describe("analyzeRepetitionText - stop words", () => {
  it("never flags a stop word no matter how often it repeats", () => {
    const text = Array(200).fill("the").join(" ");
    const report = analyzeRepetitionText(text, [], { ...DEFAULT_THRESHOLDS, minWordCount: 1, wordRatePer1000: 0 });
    expect(report.words).toEqual([]);
  });

  it("never flags a phrase made entirely of stop words", () => {
    const text = Array(50).fill("of the").join(" ");
    const report = analyzeRepetitionText(text, [], { ...DEFAULT_THRESHOLDS, minPhraseCount: 1, phraseRatePer1000: 0 });
    expect(report.phrases.find((p) => p.text === "of the")).toBeUndefined();
  });

  it("still flags a phrase that mixes stop words with content words", () => {
    const text = Array(10).fill("out of the fog").join(" ");
    const report = analyzeRepetitionText(text, [], {
      ...DEFAULT_THRESHOLDS,
      minPhraseCount: 5,
      phraseRatePer1000: 0,
      phraseLengths: [4],
    });
    expect(report.phrases.find((p) => p.text === "out of the fog")?.count).toBe(10);
  });

  it("treats contractions typed with a curly apostrophe as stop words, counted with the straight form", () => {
    const text = Array(10).fill("I don’t know, I’m sure I couldn’t say. I don't mind.").join(" ");
    const report = analyzeRepetitionText(text, [], { ...DEFAULT_THRESHOLDS, minWordCount: 1, wordRatePer1000: 0 });
    const words = report.words.map((w) => w.text);
    expect(words).not.toContain("don’t");
    expect(words).not.toContain("don't");
    expect(words).not.toContain("i’m");
    expect(words).not.toContain("couldn’t");
    expect(report.words.find((w) => w.text === "know")?.count).toBe(10);
  });

  it("never flags a stop word that ends in 's", () => {
    const text = Array(20).fill("let's").join(" ");
    const report = analyzeRepetitionText(text, [], { ...DEFAULT_THRESHOLDS, minWordCount: 1, wordRatePer1000: 0 });
    expect(report.words).toEqual([]);
  });
});

describe("analyzeRepetitionText - character names", () => {
  it("splits a full name into excludable tokens", () => {
    expect(nameTokens("Marta Chen")).toEqual(["marta", "chen"]);
  });

  it("never flags a character's name as an overused word", () => {
    const text = Array(50).fill("Marta walked to the window.").join(" ");
    const report = analyzeRepetitionText(text, ["Marta Chen"], {
      ...DEFAULT_THRESHOLDS,
      minWordCount: 5,
      wordRatePer1000: 0,
    });
    expect(report.words.find((w) => w.text === "marta")).toBeUndefined();
  });

  it("ignores a possessive form of the name too", () => {
    const excluded = buildExclusionSet(["Marta Chen"]);
    expect(excluded.has("marta")).toBe(true);
    const text = Array(10).fill("Marta's coat hung by the door.").join(" ");
    const report = analyzeRepetitionText(text, ["Marta Chen"], {
      ...DEFAULT_THRESHOLDS,
      minWordCount: 3,
      wordRatePer1000: 0,
    });
    expect(report.words.find((w) => w.text === "marta's")).toBeUndefined();
  });

  it("still flags a repeated phrase that happens to include a name", () => {
    const text = Array(10).fill("Marta felt a chill run down her spine.").join(" ");
    const report = analyzeRepetitionText(text, ["Marta Chen"], {
      ...DEFAULT_THRESHOLDS,
      minPhraseCount: 5,
      phraseRatePer1000: 0,
      phraseLengths: [3],
    });
    expect(report.phrases.find((p) => p.text === "marta felt a")?.count).toBe(10);
  });

  it("excludes a full name repeated as a two-word phrase", () => {
    const text = Array(10).fill("Marta Chen laughed.").join(" ");
    const report = analyzeRepetitionText(text, ["Marta Chen"], {
      ...DEFAULT_THRESHOLDS,
      minPhraseCount: 5,
      phraseRatePer1000: 0,
      phraseLengths: [2],
    });
    expect(report.phrases.find((p) => p.text === "marta chen")).toBeUndefined();
  });
});

describe("analyzeRepetitionText - phrase n-grams", () => {
  it("detects repeated 3- and 4-word phrases independently", () => {
    const text = Array(8).fill("she felt a chill run through her").join(". ") + ".";
    const report = analyzeRepetitionText(text, [], {
      ...DEFAULT_THRESHOLDS,
      minPhraseCount: 4,
      phraseRatePer1000: 0,
      phraseLengths: [3, 4],
    });
    expect(report.phrases.some((p) => p.text.split(" ").length === 3)).toBe(true);
    expect(report.phrases.some((p) => p.text.split(" ").length === 4)).toBe(true);
  });

  it("does not let a phrase span a paragraph break", () => {
    const text = "the fog rolled in slowly\n\nslowly the tide went out";
    const report = analyzeRepetitionText(text, [], {
      ...DEFAULT_THRESHOLDS,
      minPhraseCount: 1,
      phraseRatePer1000: 0,
      phraseLengths: [2],
    });
    expect(report.phrases.find((p) => p.text === "slowly slowly")).toBeUndefined();
  });

  it("does not let a phrase span sentence or clause punctuation", () => {
    const text = Array(10).fill('"Yes," she said. The door creaked - open wide.').join("\n");
    const report = analyzeRepetitionText(text, [], {
      ...DEFAULT_THRESHOLDS,
      minPhraseCount: 1,
      phraseRatePer1000: 0,
      phraseLengths: [2, 3],
    });
    const phrases = report.phrases.map((p) => p.text);
    expect(phrases).not.toContain("yes she said");
    expect(phrases).not.toContain("said the");
    expect(phrases).not.toContain("creaked open");
    expect(report.phrases.find((p) => p.text === "the door creaked")?.count).toBe(10);
    expect(report.phrases.find((p) => p.text === "open wide")?.count).toBe(10);
    expect(report.wordsAnalyzed).toBe(80);
  });

  it("keeps a contraction whole inside a phrase", () => {
    const text = Array(5).fill("she didn’t look back").join(". ");
    const report = analyzeRepetitionText(text, [], {
      ...DEFAULT_THRESHOLDS,
      minPhraseCount: 1,
      phraseRatePer1000: 0,
      phraseLengths: [4],
    });
    expect(report.phrases.find((p) => p.text === "she didn't look back")?.count).toBe(5);
  });

  it("respects configured phrase lengths only", () => {
    const text = Array(6).fill("a small tired smile").join(" ");
    const report = analyzeRepetitionText(text, [], {
      ...DEFAULT_THRESHOLDS,
      minPhraseCount: 5,
      phraseRatePer1000: 0,
      phraseLengths: [2],
    });
    expect(report.phrases.every((p) => p.text.split(" ").length === 2)).toBe(true);
  });
});

describe("analyzeManuscriptRepetition", () => {
  it("scopes chapter flags to that chapter and aggregates across the manuscript", () => {
    const chapterA = { id: "a", title: "One", number: 1, text: Array(6).fill("glimmer").join(" ") };
    const chapterB = { id: "b", title: "Two", number: 2, text: Array(6).fill("glimmer").join(" ") };
    const thresholds = { ...DEFAULT_THRESHOLDS, minWordCount: 5, wordRatePer1000: 0 };

    const report = analyzeManuscriptRepetition([chapterA, chapterB], [], thresholds);
    expect(report.chapters).toHaveLength(2);
    expect(report.chapters[0].words.find((w) => w.text === "glimmer")?.count).toBe(6);
    expect(report.chapters[1].words.find((w) => w.text === "glimmer")?.count).toBe(6);
    expect(report.manuscript.words.find((w) => w.text === "glimmer")?.count).toBe(12);
  });

  it("can flag a word manuscript-wide that no single chapter reaches alone", () => {
    // 4 in each chapter: below a per-chapter floor of 5, but 12 manuscript-wide clears it.
    const text = Array(4).fill("glimmer").join(" ") + " filler filler filler filler filler";
    const chapters = [1, 2, 3].map((n) => ({ id: `c${n}`, title: `Ch ${n}`, number: n, text }));
    const thresholds = { ...DEFAULT_THRESHOLDS, minWordCount: 5, wordRatePer1000: 0 };

    const report = analyzeManuscriptRepetition(chapters, [], thresholds);
    for (const chapter of report.chapters) {
      expect(chapter.words.find((w) => w.text === "glimmer")).toBeUndefined();
    }
    expect(report.manuscript.words.find((w) => w.text === "glimmer")?.count).toBe(12);
  });

  it("keeps character-name exclusion consistent across every chapter", () => {
    const text = Array(10).fill("Marta walked outside").join(" ");
    const chapters = [
      { id: "a", title: "One", number: 1, text },
      { id: "b", title: "Two", number: 2, text },
    ];
    const report = analyzeManuscriptRepetition(chapters, ["Marta Chen"], {
      ...DEFAULT_THRESHOLDS,
      minWordCount: 5,
      wordRatePer1000: 0,
    });
    expect(report.manuscript.words.find((w) => w.text === "marta")).toBeUndefined();
    for (const chapter of report.chapters) {
      expect(chapter.words.find((w) => w.text === "marta")).toBeUndefined();
    }
  });
});

describe("analyzeManuscriptRepetition - performance", () => {
  it("analyzes a ~150k-word manuscript quickly", () => {
    // 30 chapters of 5,000 words each. Every chapter repeats one overused word
    // and one overused phrase, on top of varied filler, to exercise the real
    // shape of the work rather than a degenerate all-one-word input.
    const filler = [
      "the lantern swayed against the wall",
      "a quiet rain kept falling outside",
      "footsteps echoed down the empty hall",
      "morning light crossed the wooden floor",
      "the letter sat unopened on the desk",
    ];
    const chapters = Array.from({ length: 30 }, (_, i) => {
      const words: string[] = [];
      while (words.length < 4900) {
        words.push(...filler[words.length % filler.length].split(" "));
        words.push("shimmered");
      }
      words.push(...Array(20).fill("her heart skipped a beat").join(" ").split(" "));
      return { id: `c${i}`, title: `Chapter ${i + 1}`, number: i + 1, text: words.join(" ") };
    });
    const totalWords = chapters.reduce((n, c) => n + c.text.split(" ").length, 0);
    expect(totalWords).toBeGreaterThan(140000);

    const start = performance.now();
    const report = analyzeManuscriptRepetition(chapters, ["Marta Chen"]);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000);
    expect(report.manuscript.words.find((w) => w.text === "shimmered")).toBeDefined();
    expect(report.chapters).toHaveLength(30);
  });
});
