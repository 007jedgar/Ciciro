import { describe, expect, it } from "vitest";
import {
  aiInvolvement,
  aiInvolvementPercentLabel,
  chapterPlainText,
  chapterWordsAdded,
  countWords,
  describeAiInvolvement,
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
  it("is zero when nothing was ever added", () => {
    expect(aiInvolvement({})).toEqual({
      acceptedWords: 0,
      draftedWords: 0,
      ciciroWords: 0,
      wordsAdded: 0,
      authorWords: 0,
      percent: 0,
      since: null,
    });
  });

  it("reports Ciciro's share of every word added, alongside the counts", () => {
    const since = "2026-09-01T00:00:00.000Z";
    expect(
      aiInvolvement({ aiAcceptedWords: 30, aiDraftedWords: 20, wordsAdded: 300, aiInvolvementSince: since })
    ).toEqual({
      acceptedWords: 30,
      draftedWords: 20,
      ciciroWords: 50,
      wordsAdded: 300,
      authorWords: 250,
      percent: 17,
      since: new Date(since),
    });
  });

  it("divides by words added, not the chapter's current length, so deletions don't inflate it", () => {
    // 300 Ciciro words accepted, then deleted, then 300 of the author's own:
    // half of what was ever added came from Ciciro, whatever is left now.
    const result = aiInvolvement({ aiAcceptedWords: 300, wordsAdded: 600 });
    expect(result.percent).toBe(50);
    expect(result.authorWords).toBe(300);
  });

  it("never reads over 100% when the Ciciro tally lands before the total", () => {
    const result = aiInvolvement({ aiAcceptedWords: 40, wordsAdded: 10 });
    expect(result).toMatchObject({ wordsAdded: 40, authorWords: 0, percent: 100 });
  });

  it("ignores an unparseable tracking start", () => {
    expect(aiInvolvement({ aiInvolvementSince: "not a date" }).since).toBeNull();
  });
});

describe("manuscriptAiInvolvement", () => {
  it("sums every chapter before one percentage, and dates tracking from the earliest", () => {
    const result = manuscriptAiInvolvement([
      { aiAcceptedWords: 10, wordsAdded: 100, aiInvolvementSince: "2026-09-10T00:00:00.000Z" },
      { aiDraftedWords: 40, wordsAdded: 200, aiInvolvementSince: new Date("2026-09-02T00:00:00.000Z") },
      { wordsAdded: 50 },
    ]);
    expect(result).toEqual({
      acceptedWords: 10,
      draftedWords: 40,
      ciciroWords: 50,
      wordsAdded: 350,
      authorWords: 300,
      percent: 14,
      since: new Date("2026-09-02T00:00:00.000Z"),
    });
  });

  it("is zero for a manuscript with no chapters", () => {
    expect(manuscriptAiInvolvement([]).percent).toBe(0);
  });
});

describe("describeAiInvolvement", () => {
  it("states the percentage with both cumulative sides", () => {
    expect(describeAiInvolvement(aiInvolvement({ aiAcceptedWords: 100, aiDraftedWords: 20, wordsAdded: 1000 }))).toBe(
      "12% of the 1,000 words added came from Ciciro (100 from accepted suggestions, 20 inserted directly); " +
        "880 you wrote yourself"
    );
  });
});

describe("aiInvolvementPercentLabel", () => {
  it("reads <1% when Ciciro contributed too few words to round up", () => {
    const involvement = aiInvolvement({ aiAcceptedWords: 10, wordsAdded: 5000 });
    expect(aiInvolvementPercentLabel(involvement)).toBe("<1%");
    expect(describeAiInvolvement(involvement)).toMatch(/^<1% of the 5,000 words added came from Ciciro/);
  });

  it("reads 0% only when Ciciro contributed nothing", () => {
    expect(aiInvolvementPercentLabel(aiInvolvement({ wordsAdded: 5000 }))).toBe("0%");
  });

  it("shows the rounded percentage otherwise", () => {
    expect(aiInvolvementPercentLabel(aiInvolvement({ aiDraftedWords: 30, wordsAdded: 100 }))).toBe("30%");
  });
});

describe("chapterWordsAdded", () => {
  const p = (text: string) => `<p>${text}</p>`;

  it("counts typed words", () => {
    expect(chapterWordsAdded(p("She walked home."), p("She walked home. Then she slept."))).toBe(3);
  });

  it("counts a replacement's new words, not its net change", () => {
    expect(chapterWordsAdded(p("She walked slowly to the door."), p("She ambled to the door."))).toBe(1);
  });

  it("counts nothing for a deletion", () => {
    expect(chapterWordsAdded(p("She walked slowly to the door."), p("She walked to the door."))).toBe(0);
  });

  it("counts edits in two places without the unchanged text between them", () => {
    expect(chapterWordsAdded(p("one two three four five"), p("one new two three four five more"))).toBe(2);
  });

  it("counts a pending suggestion only once it is accepted", () => {
    const attrs = 'data-author-id="ciciro" data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z"';
    const pending = `<p>She <del data-suggestion-id="s" ${attrs}>walked</del><ins data-suggestion-id="s" ${attrs}>sprinted</ins> home.</p>`;
    expect(chapterWordsAdded(p("She walked home."), pending)).toBe(0);
    expect(chapterWordsAdded(pending, p("She sprinted home."))).toBe(1);
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
