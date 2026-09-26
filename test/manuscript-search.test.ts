import { describe, expect, it } from "vitest";
import {
  findMatches,
  replaceInBlockHtml,
  searchBlockHtml,
  snippetAround,
} from "@/lib/manuscript-search";

const loose = { matchCase: false, wholeWord: false };

describe("findMatches", () => {
  it("ignores case unless asked", () => {
    expect(findMatches("Rose rose ROSE", "rose", loose)).toHaveLength(3);
    expect(findMatches("Rose rose ROSE", "rose", { ...loose, matchCase: true })).toEqual([
      { start: 5, end: 9 },
    ]);
  });

  it("matches whole words only when asked", () => {
    const text = "The cat's catalog, a cat.";
    expect(findMatches(text, "cat", loose)).toHaveLength(3);
    const whole = findMatches(text, "cat", { ...loose, wholeWord: true });
    expect(whole.map((m) => m.start)).toEqual([4, 21]);
  });

  it("treats a query that starts or ends on punctuation literally", () => {
    expect(findMatches("well, (maybe) not", "(maybe)", { ...loose, wholeWord: true })).toHaveLength(1);
  });

  it("does not match across a hard break or an empty query", () => {
    expect(searchBlockHtml("<p>one<br>two</p>", "one two", loose).matches).toHaveLength(0);
    expect(findMatches("abc", "", loose)).toEqual([]);
  });

  it("treats paragraphs inside a quote as separate for matching", () => {
    const html = "<blockquote><p>He said</p><p>no</p></blockquote>";
    expect(searchBlockHtml(html, "said", { ...loose, wholeWord: true }).matches).toEqual([
      { start: 3, end: 7 },
    ]);
    expect(searchBlockHtml(html, "saidno", loose).matches).toHaveLength(0);
    expect(replaceInBlockHtml(html, "saidno", "x", loose)).toEqual({ html, count: 0 });
    expect(searchBlockHtml(html, "no", { ...loose, wholeWord: true }).matches).toEqual([
      { start: 7, end: 9 },
    ]);
  });

  it("keeps offsets stable for characters that change length when lowercased", () => {
    expect(findMatches("İ needle", "needle", loose)).toEqual([{ start: 2, end: 8 }]);
  });
});

describe("replaceInBlockHtml", () => {
  it("replaces inside a single text node and keeps the tag attributes", () => {
    const out = replaceInBlockHtml('<p data-block-id="a">Meet Jon today</p>', "Jon", "Jonathan", loose);
    expect(out).toEqual({ html: '<p data-block-id="a">Meet Jonathan today</p>', count: 1 });
  });

  it("replaces a match that spans an inline mark", () => {
    const out = replaceInBlockHtml("<p>a Jo<em>hn</em> b</p>", "John", "Sam", loose);
    expect(out.html).toBe("<p>a Sam<em></em> b</p>");
    expect(out.count).toBe(1);
  });

  it("replaces one occurrence by index", () => {
    const out = replaceInBlockHtml("<p>x x x</p>", "x", "y", loose, { occurrence: 1, offset: 2 });
    expect(out.html).toBe("<p>x y x</p>");
    expect(replaceInBlockHtml("<p>x</p>", "x", "y", loose, { occurrence: 3, offset: 0 })).toEqual({
      html: "<p>x</p>",
      count: 0,
    });
  });

  it("leaves an occurrence alone when it no longer starts where it was found", () => {
    const html = "<p>Jon, Jon met Jon</p>";
    expect(replaceInBlockHtml(html, "Jon", "Ann", loose, { occurrence: 1, offset: 8 })).toEqual({
      html,
      count: 0,
    });
  });

  it("replaces every occurrence, including adjacent ones", () => {
    expect(replaceInBlockHtml("<p>aaaa</p>", "aa", "b", loose).html).toBe("<p>bb</p>");
  });

  it("decodes entities to match and re-encodes what it writes", () => {
    const out = replaceInBlockHtml("<p>Tom &amp; Jerry &quot;ok&quot;</p>", "Tom & Jerry", "A<B", loose);
    // The touched node is re-encoded; a literal quote is equivalent HTML.
    expect(out.html).toBe('<p>A&lt;B "ok"</p>');
  });

  it("leaves untouched text nodes byte-for-byte", () => {
    const html = "<p>&quot;hi&quot; <em>cat</em></p>";
    expect(replaceInBlockHtml(html, "cat", "dog", loose).html).toBe("<p>&quot;hi&quot; <em>dog</em></p>");
  });

  it("supports deleting with an empty replacement", () => {
    expect(replaceInBlockHtml("<p>very good</p>", "very ", "", loose).html).toBe("<p>good</p>");
  });

  it("keeps non-breaking spaces in text it rewrites and matches them as spaces", () => {
    expect(replaceInBlockHtml("<p>Jon&nbsp; said</p>", "Jon", "Joan", loose).html).toBe(
      "<p>Joan&nbsp; said</p>"
    );
    expect(replaceInBlockHtml("<p>New&nbsp;York</p>", "new york", "Boston", loose).html).toBe(
      "<p>Boston</p>"
    );
  });
});

describe("snippetAround", () => {
  it("adds ellipses only where text was cut", () => {
    const text = "a".repeat(100) + "NEEDLE" + "b".repeat(100);
    const s = snippetAround(text, { start: 100, end: 106 });
    expect(s.match).toBe("NEEDLE");
    expect(s.before.startsWith("…")).toBe(true);
    expect(s.after.endsWith("…")).toBe(true);
    expect(snippetAround("short NEEDLE", { start: 6, end: 12 }).before).toBe("short ");
  });

  it("separates the paragraphs of a quote in the preview", () => {
    const html = "<blockquote><p>Keep the lamp lit, he said</p><p>no matter what.</p></blockquote>";
    const found = searchBlockHtml(html, "said", loose);
    expect(snippetAround(found.text, found.matches[0], undefined, found.boundaries)).toEqual({
      before: "Keep the lamp lit, he ",
      match: "said",
      after: " no matter what.",
    });
    const next = searchBlockHtml(html, "no", loose);
    expect(snippetAround(next.text, next.matches[0], undefined, next.boundaries).before).toBe(
      "Keep the lamp lit, he said "
    );
  });
});

describe("pending suggestions", () => {
  const attrs = 'data-author-id="ciciro" data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z"';
  const block =
    `<p data-block-id="a">She <del data-suggestion-id="s1" ${attrs}>walked slowly</del>` +
    `<ins data-suggestion-id="s1" ${attrs}>crossed</ins> to the door. She walked on.</p>`;
  const loose = { matchCase: false, wholeWord: false };

  it("does not match inside or across a pending change", () => {
    const { matches, text } = searchBlockHtml(block, "walked", loose);
    expect(matches).toHaveLength(1);
    expect(text.slice(matches[0].start, matches[0].end + 3)).toBe("walked on");
    expect(searchBlockHtml(block, "slowlycrossed", loose).matches).toHaveLength(0);
  });

  it("replaces only outside pending changes and leaves the marks byte-for-byte", () => {
    const out = replaceInBlockHtml(block, "walked", "strode", loose);
    expect(out.count).toBe(1);
    expect(out.html).toBe(block.replace("She walked on.", "She strode on."));
  });
});
