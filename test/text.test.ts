import { describe, expect, it } from "vitest";
import {
  aiInvolvement,
  chapterPlainText,
  countWords,
  extractDraft,
  htmlToText,
  isChapterEmpty,
  manuscriptAiInvolvement,
} from "@/lib/text";

describe("htmlToText", () => {
  it("returns empty string for empty input", () => {
    expect(htmlToText("")).toBe("");
  });

  it("turns block tags into paragraph breaks and strips inline tags", () => {
    const html = "<p>Hello <strong>world</strong></p><p>Second</p>";
    expect(htmlToText(html)).toBe("Hello world\n\nSecond");
  });

  it("converts <br> to a single newline", () => {
    expect(htmlToText("line one<br>line two")).toBe("line one\nline two");
  });

  it("decodes common HTML entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3 &quot;x&quot; &#39;y&#39;</p>")).toBe(
      "Tom & Jerry <3 \"x\" 'y'"
    );
  });

  it("collapses runs of blank lines", () => {
    expect(htmlToText("<p>a</p><p></p><p></p><p>b</p>")).toBe("a\n\nb");
  });
});

describe("countWords", () => {
  it("counts zero for blank strings", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n  ")).toBe(0);
  });

  it("counts words separated by any whitespace", () => {
    expect(countWords("one")).toBe(1);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  spaced \n out\twords  ")).toBe(3);
  });
});

describe("isChapterEmpty", () => {
  it("treats blank and empty TipTap markup as empty", () => {
    expect(isChapterEmpty("")).toBe(true);
    expect(isChapterEmpty("<p></p>")).toBe(true);
    expect(isChapterEmpty("<p>&nbsp;</p>")).toBe(true);
  });

  it("treats chapters with prose as not empty", () => {
    expect(isChapterEmpty("<p>Hello</p>")).toBe(false);
  });
});

describe("extractDraft", () => {
  it("pulls the trimmed body of a <draft> block", () => {
    expect(extractDraft("Intro <draft>  the prose  </draft> outro")).toBe("the prose");
  });

  it("is case-insensitive and spans newlines", () => {
    expect(extractDraft("<DRAFT>line one\nline two</DRAFT>")).toBe("line one\nline two");
  });

  it("returns null when there is no draft", () => {
    expect(extractDraft("just chatting")).toBeNull();
  });
});

describe("aiInvolvement", () => {
  it("is all-author when nothing was ever accepted or drafted", () => {
    expect(aiInvolvement({ wordCount: 100, aiAcceptedWords: 0, aiDraftedWords: 0 })).toEqual({
      totalWords: 100,
      ciciroWords: 0,
      authorWords: 100,
      percent: 0,
    });
  });

  it("treats missing counters as 0 (an untracked or pre-tracking chapter)", () => {
    expect(aiInvolvement({ wordCount: 50 })).toEqual({
      totalWords: 50,
      ciciroWords: 0,
      authorWords: 50,
      percent: 0,
    });
  });

  it("sums accepted-suggestion and drafted words, and rounds the percentage", () => {
    expect(aiInvolvement({ wordCount: 300, aiAcceptedWords: 30, aiDraftedWords: 20 })).toEqual({
      totalWords: 300,
      ciciroWords: 50,
      authorWords: 250,
      percent: 17,
    });
  });

  it("clamps at 100% when heavy deletion of the author's own prose outpaces the chapter's growth", () => {
    // The chapter shrank below its lifetime Ciciro tally; the percentage
    // still reads as a sane 0-100%, not over 100.
    expect(aiInvolvement({ wordCount: 10, aiAcceptedWords: 40, aiDraftedWords: 0 })).toEqual({
      totalWords: 10,
      ciciroWords: 10,
      authorWords: 0,
      percent: 100,
    });
  });

  it("is 0% for an empty chapter rather than dividing by zero", () => {
    expect(aiInvolvement({ wordCount: 0, aiAcceptedWords: 0, aiDraftedWords: 0 }).percent).toBe(0);
  });
});

describe("manuscriptAiInvolvement", () => {
  it("aggregates every chapter before computing one manuscript-wide percentage", () => {
    const result = manuscriptAiInvolvement([
      { wordCount: 100, aiAcceptedWords: 10, aiDraftedWords: 0 },
      { wordCount: 200, aiAcceptedWords: 0, aiDraftedWords: 40 },
      { wordCount: 50 },
    ]);
    expect(result).toEqual({ totalWords: 350, ciciroWords: 50, authorWords: 300, percent: 14 });
  });

  it("is 0% for a manuscript with no chapters", () => {
    expect(manuscriptAiInvolvement([])).toEqual({ totalWords: 0, ciciroWords: 0, authorWords: 0, percent: 0 });
  });
});

describe("chapterPlainText", () => {
  const attrs = 'data-author-id="ciciro" data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z"';
  const html =
    `<p>She <del data-suggestion-id="s" ${attrs}>walked</del><ins data-suggestion-id="s" ${attrs}>sprinted</ins> home.</p>`;

  it("reads a pending replacement as the prose that stands, not both halves", () => {
    expect(htmlToText(html)).toBe("She walkedsprinted home.");
    expect(chapterPlainText(html)).toBe("She walked home.");
  });
});
