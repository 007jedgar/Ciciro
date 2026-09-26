import { fromEnrichedHtml, toEnrichedHtml } from "../lib/enriched-html";
import { htmlToDoc } from "../lib/manuscript";
import {
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

  it("acts on an English voice command spoken on its own", () => {
    expect(prepareDictation("new paragraph", "It was", "en-US")).toBe("\n\n");
    expect(prepareDictation("New line.", "It was", "en-US")).toBe("\n");
    expect(prepareDictation("full stop", "It was", "en-US")).toBe(".");
    expect(prepareDictation("new paragraph", "x", "es-ES")).toBe(
      " new paragraph",
    );
  });

  it("keeps command words inside a longer phrase as spoken", () => {
    expect(prepareDictation("The car came to a full stop", "", "en")).toBe(
      "The car came to a full stop",
    );
    expect(prepareDictation("a new line of work", "", "en")).toBe(
      "A new line of work",
    );
    expect(prepareDictation("the colon", "It hit", "en")).toBe(" the colon");
  });

  it("drops silence", () => {
    expect(prepareDictation("  ", "x")).toBe("");
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
    const out = insertDictation(html, 3, "new paragraph", "en");
    expect(texts(out!.html)).toEqual(["One", "two"]);
    expect(out!.html).not.toContain("<br");
    const ids = htmlToDoc(out!.html, 0).doc.blocks.map((b) => b.id);
    expect(ids[0]).toBe("a");
    expect(new Set(ids).size).toBe(2);
    expect(out!.caret).toBe(4);
  });

  it("splits a paragraph on a spoken line break, since the phone has no in-block break", () => {
    const html = '<p data-block-id="a">One two</p>';
    const out = insertDictation(html, 3, "new line", "en");
    expect(out!.html).not.toContain("<br");
    const back = fromEnrichedHtml(toEnrichedHtml(out!.html));
    expect(texts(back)).toEqual(["One", "two"]);
    expect(out!.caret).toBe(4);
  });

  it("ignores a spoken break inside a quote, keeping it one block", () => {
    const html = '<blockquote data-block-id="q">Quoted</blockquote>';
    expect(insertDictation(html, 6, "new paragraph", "en")).toBeNull();
    const out = insertDictation(html, 6, "more", "en");
    expect(texts(out!.html)).toEqual(["Quoted more"]);
  });

  it("puts text after a scene break in a new paragraph", () => {
    const html =
      '<p data-block-id="a">One</p><hr data-block-id="h" /><p data-block-id="b">Two</p>';
    // The editor shows the break as "***": caret at its end is 3 + 1 + 3.
    const out = insertDictation(html, 7, "next", "en");
    expect(texts(out!.html)).toEqual(["One", "#", "Next", "Two"]);
    // "One\n***\nNext" puts the caret right after "Next".
    expect(out!.caret).toBe(12);
  });

  it("counts a scene break as the editor shows it when finding the caret", () => {
    const html =
      '<p data-block-id="a">One</p><hr data-block-id="h" /><p data-block-id="b">Two words</p>';
    // Editor text is "One\n***\nTwo words"; offset 11 is just after "Two".
    const out = insertDictation(html, 11, "hello", "en");
    expect(texts(out!.html)).toEqual(["One", "#", "Two hello words"]);
    expect(out!.caret).toBe(11 + " hello".length);
  });

  it("keeps a space before the next word when dictating right after a split", () => {
    const split = insertDictation('<p data-block-id="a">One two</p>', 3, "new paragraph", "en");
    const out = insertDictation(split!.html, split!.caret, "hello", "en");
    expect(texts(out!.html)).toEqual(["One", "Hello two"]);
    expect(out!.caret).toBe(4 + "Hello ".length);
  });

  it("counts a typed scene break as the characters the editor shows", () => {
    const html = "<p>One</p><p>#</p><p>Two words</p>";
    // Editor text is "One\n#\nTwo words"; offset 9 is just after "Two".
    const out = insertDictation(html, 9, "hello", "en");
    expect(texts(out!.html)).toEqual(["One", "#", "Two hello words"]);
    const after = insertDictation(html, 5, "next", "en");
    expect(texts(after!.html)).toEqual(["One", "#", "Next", "Two words"]);
    expect(after!.caret).toBe(4 + 1 + 1 + "Next".length);
  });
});

