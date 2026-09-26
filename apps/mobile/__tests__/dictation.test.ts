import { htmlToDoc } from "../lib/manuscript";
import {
  dictatedLength,
  dictationLocale,
  insertDictation,
  prepareDictation,
} from "../lib/dictation";

const doc =
  '<p data-block-id="a">The door opened.</p><p data-block-id="b">She waited</p>';

function texts(html: string): string[] {
  return htmlToDoc(html, 0).doc.blocks.map((b) => b.text);
}

describe("prepareDictation", () => {
  it("capitalizes a sentence start and joins with one space", () => {
    expect(prepareDictation("then it closed", "The door opened.")).toBe(
      " Then it closed",
    );
    expect(prepareDictation("and waited", "She stood")).toBe(" and waited");
    expect(prepareDictation("hello", "")).toBe("Hello");
  });

  it("turns English voice commands into breaks and punctuation", () => {
    expect(prepareDictation("done new paragraph next", "It was", "en-US")).toBe(
      " done\n\nNext",
    );
    expect(prepareDictation("really question mark", "Is it", "en-US")).toBe(
      " really?",
    );
    expect(prepareDictation("new paragraph", "x", "es-ES")).toBe(
      " new paragraph",
    );
  });

  it("drops silence", () => {
    expect(prepareDictation("  ", "x")).toBe("");
  });
});

describe("dictatedLength", () => {
  it("counts a paragraph break as one character", () => {
    expect(dictatedLength("ab\n\ncd")).toBe(5);
  });
});

describe("dictationLocale", () => {
  it("qualifies bare app languages and keeps regional tags", () => {
    expect(dictationLocale("es")).toBe("es-ES");
    expect(dictationLocale("en-GB")).toBe("en-GB");
    expect(dictationLocale("xx")).toBe("en-US");
  });
});

describe("insertDictation", () => {
  it("inserts at the caret in the middle of a block", () => {
    // offset 17 = start of "She waited" (16 chars + separator) + 3
    const out = insertDictation(doc, 17 + 3, "quietly", "en");
    expect(out).not.toBeNull();
    expect(texts(out!.html)).toEqual([
      "The door opened.",
      "She quietly waited",
    ]);
    expect(out!.caret).toBe(20 + " quietly".length);
  });

  it("appends at the end of a block", () => {
    const out = insertDictation(doc, 17 + 10, "for him.", "en");
    expect(texts(out!.html)[1]).toBe("She waited for him.");
  });

  it("keeps inline marks and block ids intact around the caret", () => {
    const html =
      '<p data-block-id="a">Hello <strong>bold</strong> &amp; more</p>';
    const out = insertDictation(html, 10, "very", "en");
    expect(out!.html).toBe(
      '<p data-block-id="a">Hello <strong>bold</strong> very &amp; more</p>',
    );
  });

  it("escapes markup in dictated text", () => {
    const out = insertDictation('<p data-block-id="a">x</p>', 1, "a < b", "en");
    expect(out!.html).toContain("a &lt; b");
  });

  it("starts an empty chapter", () => {
    const out = insertDictation("", 0, "once upon a time", "en");
    expect(texts(out!.html)).toEqual(["Once upon a time"]);
  });

  it("splits a paragraph on a spoken paragraph break", () => {
    const html = '<p data-block-id="a">One two</p>';
    const out = insertDictation(html, 3, "new paragraph three", "en");
    expect(texts(out!.html)).toEqual(["One", "Three two"]);
    const ids = htmlToDoc(out!.html, 0).doc.blocks.map((b) => b.id);
    expect(ids[0]).toBe("a");
    expect(new Set(ids).size).toBe(2);
  });

  it("does not split a quote, keeping it one block", () => {
    const html = '<blockquote data-block-id="q">Quoted</blockquote>';
    const out = insertDictation(html, 6, "new paragraph more", "en");
    expect(texts(out!.html)).toHaveLength(1);
  });

  it("puts text after a scene break in a new paragraph", () => {
    const html =
      '<p data-block-id="a">One</p><hr data-block-id="h" /><p data-block-id="b">Two</p>';
    const out = insertDictation(html, 4, "next", "en");
    expect(texts(out!.html)).toHaveLength(4);
  });
});
