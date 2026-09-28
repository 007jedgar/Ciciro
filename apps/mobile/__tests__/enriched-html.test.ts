import {
  blockAtPlainOffset,
  fromEnrichedHtml,
  opsFromEnrichedHtml,
  restampCiciroHtml,
  toEnrichedHtml,
} from "../lib/enriched-html";
import { htmlToDoc } from "../lib/manuscript";

describe("enriched html adapter", () => {
  it("wraps an empty chapter so the editor does not show the paragraph tags", () => {
    expect(toEnrichedHtml("")).toBe("<html><p></p></html>");
    expect(toEnrichedHtml('<p data-block-id="a"></p>')).toBe("<html><p></p></html>");
    expect(toEnrichedHtml("<p>Hi</p>")).toBe("<html><p>Hi</p></html>");
  });

  it("strips block ids and wraps lists for the native input", () => {
    const ciciro =
      '<p data-block-id="a">Hello <strong>there</strong>.</p><li data-block-id="b">Item</li><hr data-block-id="c" />';
    expect(toEnrichedHtml(ciciro)).toBe(
      "<p>Hello <b>there</b>.</p><ul><li>Item</li></ul><p>***</p>"
    );
  });

  it("turns Enriched output into Ciciro blocks", () => {
    const enriched =
      "<html><b>Hi</b> <i>you</i><br><blockquote><p>Quoted</p></blockquote><ul><li>One</li></ul></html>";
    const next = fromEnrichedHtml(enriched);
    expect(next).toContain("<strong>Hi</strong>");
    expect(next).toContain("<em>you</em>");
    expect(next).toContain("<p></p>");
    expect(next).toContain("<blockquote><p>Quoted</p></blockquote>");
    expect(next).toContain("<li>One</li>");
  });

  it("keeps ids when a paragraph is only edited in place", () => {
    const previous = '<p data-block-id="a">Hello.</p><p data-block-id="b">World.</p>';
    const incoming = "<p>Hello there.</p><p>World.</p>";
    const stamped = restampCiciroHtml(previous, incoming);
    const ids = htmlToDoc(stamped, 0).doc.blocks.map((block) => block.id);
    expect(ids).toEqual(["a", "b"]);
    expect(stamped).toContain("Hello there.");
  });

  it("reuses the left id when Return splits a paragraph", () => {
    const previous = '<p data-block-id="a">Hello world.</p><p data-block-id="b">Next.</p>';
    const incoming = "<p>Hello</p><p>world.</p><p>Next.</p>";
    const stamped = restampCiciroHtml(previous, incoming);
    const blocks = htmlToDoc(stamped, 0).doc.blocks;
    expect(blocks.map((block) => block.text)).toEqual(["Hello", "world.", "Next."]);
    expect(blocks[0].id).toBe("a");
    expect(blocks[2].id).toBe("b");
    expect(blocks[1].id).not.toBe("a");
    expect(blocks[1].id).not.toBe("b");
  });

  it("emits insert ops when a paragraph is added in the middle", () => {
    const previous = '<p data-block-id="a">Hello.</p><p data-block-id="b">World.</p>';
    const ops = opsFromEnrichedHtml(previous, "<p>Hello.</p><p>Inserted.</p><p>World.</p>", 3);
    expect(ops.map((op) => op.type)).toEqual(["insert_block"]);
    expect(ops[0]).toMatchObject({ type: "insert_block", afterBlockId: "a" });
  });

  describe("multi-line quotes", () => {
    // Enriched's iOS serializer represents each line inside a blockquote with
    // a <br>, and pads blank style-edge lines with extra <br>s of its own
    // (see HtmlParser.mm:parseToHtmlFromRange). Reproduces the shape actually
    // observed from a live device: docs/mobile-editor-sync-diagnosis.md and
    // the blockquote-drop report.
    const nativeOutput =
      "<html>\n<blockquote>\n<br>\n<br>\n<p>Q1</p>\n<p>Q2</p>\n<br>\n<br>\n<p>MARKER-TYPED-HERE</p>\n<br>\n</blockquote>\n</html>";

    it("keeps each quoted line as its own <p>, dropping blank style-edge lines", () => {
      const shown = fromEnrichedHtml(nativeOutput);
      expect(shown).toBe("<blockquote><p>Q1</p><p>Q2</p><p>MARKER-TYPED-HERE</p></blockquote>");
    });

    it("does not grow when the same native output is converted again", () => {
      // Regression for the compounding bug: a chapter that round-tripped once
      // used to gain more blank lines on every subsequent flush, even with no
      // further typing, because each pass left one more bare newline behind.
      const once = fromEnrichedHtml(nativeOutput);
      const twice = fromEnrichedHtml(nativeOutput);
      expect(twice).toBe(once);
    });

    it("keeps a paragraph typed while quote formatting is still active as its own <p>, not fused text", () => {
      const previous = '<blockquote data-block-id="q1"><p>Q1</p></blockquote>';
      // The user typed a new line without leaving quote formatting; Enriched
      // reports it as one more <br>-separated line inside the same blockquote.
      const incoming = "<blockquote><p>Q1</p><br><p>New paragraph</p></blockquote>";
      const shown = fromEnrichedHtml(incoming);
      expect(shown).toBe("<blockquote><p>Q1</p><p>New paragraph</p></blockquote>");
      const stamped = restampCiciroHtml(previous, shown);
      expect(stamped).toBe(
        '<blockquote data-block-id="q1"><p>Q1</p><p>New paragraph</p></blockquote>'
      );
    });

    it("stabilizes ops after the first fix-up: no ops once the stored shape matches native", () => {
      const previous = '<blockquote data-block-id="q1"><p>Q1</p><p>Q2</p></blockquote>';
      const ops = opsFromEnrichedHtml(previous, nativeOutput, 5);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ type: "replace_block", blockId: "q1" });
      const fixedUp = (ops[0] as { html: string }).html;
      // Feeding the same native output back against the now-clean stored HTML
      // produces no further ops - the runaway loop is broken.
      expect(opsFromEnrichedHtml(fixedUp, nativeOutput, 6)).toEqual([]);
    });

    it("collapses a quote emptied down to bare line breaks to a single empty paragraph", () => {
      const shown = fromEnrichedHtml("<blockquote><br><br><br></blockquote>");
      expect(shown).toBe("<blockquote><p></p></blockquote>");
    });
  });

  it("maps a document caret onto the block it sits in", () => {
    const html = '<p data-block-id="a">Hi</p><p data-block-id="b">There</p>';
    expect(blockAtPlainOffset(html, 0)).toEqual({ blockId: "a", local: 0 });
    expect(blockAtPlainOffset(html, 2)).toEqual({ blockId: "a", local: 2 });
    expect(blockAtPlainOffset(html, 3)).toEqual({ blockId: "b", local: 0 });
  });

  it("counts scene breaks as the editor shows them when mapping a caret", () => {
    const hr = '<p data-block-id="a">Hi</p><hr data-block-id="h" /><p data-block-id="b">There</p>';
    // Shown as "Hi\n***\nThere".
    expect(blockAtPlainOffset(hr, 7)).toEqual({ blockId: "b", local: 0 });
    const typed = '<p data-block-id="a">Hi</p><p data-block-id="h">#</p><p data-block-id="b">There</p>';
    // Shown as "Hi\n#\nThere".
    expect(blockAtPlainOffset(typed, 5)).toEqual({ blockId: "b", local: 0 });
  });

  describe("screenplay elements", () => {
    const previous =
      '<p data-block-id="a" data-sp="character">MARA</p><p data-block-id="b" data-sp="dialogue">Hi.</p>';

    it("keeps the native view free of the element attribute", () => {
      expect(toEnrichedHtml(previous)).toBe("<p>MARA</p><p>Hi.</p>");
    });

    it("carries each block's element through an edit the native view cannot see", () => {
      const stamped = restampCiciroHtml(previous, "<p>MARA</p><p>Hi there.</p>", { screenplay: true });
      expect(stamped).toBe(
        '<p data-block-id="a" data-sp="character">MARA</p><p data-block-id="b" data-sp="dialogue">Hi there.</p>'
      );
      expect(opsFromEnrichedHtml(previous, "<p>MARA</p><p>Hi.</p>", 3, undefined, { screenplay: true })).toEqual([]);
    });

    it("gives a new line the element that follows the one above, like Enter", () => {
      const afterCue = restampCiciroHtml(
        '<p data-block-id="a" data-sp="character">MARA</p>',
        "<p>MARA</p><p></p>",
        { screenplay: true }
      );
      const blocks = htmlToDoc(afterCue, 0).doc.blocks;
      expect(blocks.map((b) => b.html.match(/data-sp="([^"]+)"/)?.[1] ?? "action")).toEqual([
        "character",
        "dialogue",
      ]);
    });

    it("does not invent elements in a novel", () => {
      const stamped = restampCiciroHtml('<p data-block-id="a">One.</p>', "<p>One.</p><p></p>");
      expect(stamped).not.toContain("data-sp");
    });
  });
});
