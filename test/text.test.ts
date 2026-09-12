import { describe, expect, it } from "vitest";
import { countWords, extractDraft, htmlToText, isChapterEmpty } from "@/lib/text";

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

  it("omits pending deletion spans", () => {
    expect(
      htmlToText(
        '<p>Keep <del data-suggestion="delete" data-suggestion-id="s">drop</del>me</p>'
      )
    ).toBe("Keep me");
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

  it("ignores pending deletions when deciding emptiness", () => {
    expect(
      isChapterEmpty(
        '<p><del data-suggestion="delete" data-suggestion-id="s">gone</del></p>'
      )
    ).toBe(true);
    expect(
      isChapterEmpty(
        '<p><ins data-suggestion="insert" data-suggestion-id="s">kept</ins></p>'
      )
    ).toBe(false);
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
