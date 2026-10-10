import { htmlToDoc } from "../lib/manuscript";
import { insertLineAfter, replaceLineTail, replaceSelectedWord } from "../lib/selection-edit";

const doc =
  '<p data-block-id="a">The door opened.</p>' +
  '<p data-block-id="b">She did not care about the <strong>country</strong>. It was &amp; is mine.</p>';

function texts(html: string): string[] {
  return htmlToDoc(html, 0).doc.blocks.map((b) => b.text);
}

describe("replaceSelectedWord", () => {
  it("swaps a word in the first paragraph and puts the caret after it", () => {
    const result = replaceSelectedWord(doc, 4, 8, "door", "gate");
    expect(result).not.toBeNull();
    expect(texts(result!.html)[0]).toBe("The gate opened.");
    expect(result!.caret).toBe(8);
  });

  it("finds a word in a later paragraph by editor offset (paragraphs newline-separated)", () => {
    const start = "The door opened.".length + 1 + "She did not care about the ".length;
    const result = replaceSelectedWord(doc, start, start + 7, "country", "homeland");
    expect(texts(result!.html)[1]).toBe("She did not care about the homeland. It was & is mine.");
    expect(result!.caret).toBe(start + "homeland".length);
  });

  it("keeps the marks around the word it replaces", () => {
    const start = "The door opened.".length + 1 + "She did not care about the ".length;
    const result = replaceSelectedWord(doc, start, start + 7, "country", "homeland");
    expect(result!.html).toContain("<strong>homeland</strong>");
  });

  it("counts an entity as one character", () => {
    const start =
      "The door opened.".length + 1 + "She did not care about the country. It was & is ".length;
    const result = replaceSelectedWord(doc, start, start + 4, "mine", "ours");
    expect(texts(result!.html)[1]).toContain("It was & is ours.");
    expect(result!.html).toContain("&amp; is ours");
  });

  it("escapes the replacement", () => {
    const result = replaceSelectedWord(doc, 4, 8, "door", "a<b");
    expect(result!.html).toContain("The a&lt;b opened.");
  });

  it("does nothing when the word is no longer there", () => {
    expect(replaceSelectedWord(doc, 4, 8, "gate", "door")).toBeNull();
    expect(replaceSelectedWord(doc, 4, 4, "", "x")).toBeNull();
    expect(replaceSelectedWord(doc, 4, 8, "door", "")).toBeNull();
  });

  it("leaves every other block exactly as it was", () => {
    const result = replaceSelectedWord(doc, 4, 8, "door", "gate");
    expect(result!.html).toContain(
      '<p data-block-id="b">She did not care about the <strong>country</strong>. It was &amp; is mine.</p>',
    );
  });
});

describe("replaceLineTail", () => {
  const script =
    '<p data-block-id="a" data-sp="scene-heading">INT. LAB</p>' +
    '<p data-block-id="b" data-sp="character">MARA</p>' +
    '<p data-block-id="c" data-sp="dialogue">Hello.</p>';

  it("adds to the end of a line and puts the caret there", () => {
    const result = replaceLineTail(script, 0, "INT. LAB".length, "", " - ");
    expect(result).not.toBeNull();
    // A line's trailing space does not survive the chapter's text: the caret is where the text ends.
    expect(texts(result!.html)).toEqual(["INT. LAB -", "MARA", "Hello."]);
    expect(result!.caret).toBe("INT. LAB -".length);
    expect(result!.html).toContain('data-sp="scene-heading"');
  });

  it("swaps the rest of a line from where the choice begins", () => {
    const start = "INT. LAB".length + 1;
    const result = replaceLineTail(script, start, 2, "RA", "RA (V.O.)");
    expect(texts(result!.html)[1]).toBe("MARA (V.O.)");
    expect(result!.caret).toBe(start + "MARA (V.O.)".length);
  });

  it("removes the end of a line when the replacement is empty", () => {
    const withExt = '<p data-block-id="b" data-sp="character">MARA (V.O.)</p>';
    expect(texts(replaceLineTail(withExt, 0, 4, " (V.O.)", "")!.html)).toEqual(["MARA"]);
  });

  it("reads a line the writer ended in a space as the chapter holds it", () => {
    const result = replaceLineTail(script, 0, 5, "LAB ", "LAB -");
    expect(texts(result!.html)[0]).toBe("INT. LAB -");
  });

  it("does nothing when the line is no longer what the writer saw", () => {
    expect(replaceLineTail(script, "INT. LAB".length + 1, 2, "XX", "RA!")).toBeNull();
  });

  it("keeps a mark on the text it adds to", () => {
    const bold = '<p data-block-id="b" data-sp="character">MAR<strong>A</strong></p>';
    const result = replaceLineTail(bold, 0, 3, "A", "AH");
    expect(result!.html).toContain("<strong>AH</strong>");
  });
});

describe("insertLineAfter", () => {
  const script =
    '<p data-block-id="b" data-sp="character">MARA</p><p data-block-id="c" data-sp="dialogue">Hello.</p>';

  it("adds an empty line of the element after the line and puts the caret in it", () => {
    const result = insertLineAfter(script, 4, "parenthetical");
    expect(texts(result!.html)).toEqual(["MARA", "", "Hello."]);
    expect(result!.html).toMatch(/<p[^>]*data-sp="parenthetical"[^>]*><\/p>/);
    expect(result!.caret).toBe("MARA".length + 1);
  });

  it("works on the last line", () => {
    const result = insertLineAfter(script, "MARA".length + 1 + "Hello.".length, "action");
    expect(texts(result!.html)).toEqual(["MARA", "Hello.", ""]);
    expect(result!.caret).toBe("MARA".length + 1 + "Hello.".length + 1);
  });
});
