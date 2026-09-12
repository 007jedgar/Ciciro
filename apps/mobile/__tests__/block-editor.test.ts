import { htmlToDoc } from "../lib/manuscript";
import {
  mergeBlockOps,
  newParagraphHtml,
  replaceBlockOps,
  serializeBlockHtml,
  splitBlockOps,
  tagOfHtml,
} from "../lib/block-editor";

function seqIds(prefix: string) {
  let n = 0;
  return {
    createOpId: () => `${prefix}-op-${++n}`,
    createBlockId: () => `${prefix}-block-${++n}`,
  };
}

describe("block editor keystrokes", () => {
  it("turns typing into a replace_block that keeps the original tag", () => {
    const { doc } = htmlToDoc(
      '<h2 data-block-id="h1">Night</h2><blockquote data-block-id="q1">Quiet.</blockquote>',
      4
    );
    const heading = replaceBlockOps(doc, "h1", "Night Watch", seqIds("r"));
    expect(heading).toEqual([
      {
        opId: "r-op-1",
        baseRevision: 4,
        actor: "user",
        type: "replace_block",
        blockId: "h1",
        html: '<h2 data-block-id="h1">Night Watch</h2>',
      },
    ]);
    expect(tagOfHtml(heading[0].html)).toBe("h2");

    const quote = replaceBlockOps(doc, "q1", "Still quiet.", seqIds("q"));
    expect(quote[0]).toMatchObject({
      type: "replace_block",
      blockId: "q1",
      html: '<blockquote data-block-id="q1">Still quiet.</blockquote>',
    });
  });

  it("splits on return into replace_block + insert_block", () => {
    const { doc } = htmlToDoc('<p data-block-id="b1">Hello world.</p>', 2);
    const mid = splitBlockOps(doc, "b1", "Hello", " world.", seqIds("s"));
    expect(mid.ops.map((op) => op.type)).toEqual(["replace_block", "insert_block"]);
    expect(mid.ops[0]).toMatchObject({
      type: "replace_block",
      blockId: "b1",
      baseRevision: 2,
      html: '<p data-block-id="b1">Hello</p>',
    });
    expect(mid.ops[1]).toMatchObject({
      type: "insert_block",
      afterBlockId: "b1",
      baseRevision: 3,
      html: newParagraphHtml("s-block-2", " world."),
    });
    expect(mid.focusBlockId).toBe("s-block-2");
    expect(mid.focusOffset).toBe(0);

    const atEnd = splitBlockOps(doc, "b1", "Hello world.", "", seqIds("e"));
    expect(atEnd.ops).toHaveLength(1);
    expect(atEnd.ops[0]).toMatchObject({
      type: "insert_block",
      afterBlockId: "b1",
      baseRevision: 2,
      html: '<p data-block-id="e-block-1"></p>',
    });
    expect(atEnd.focusBlockId).toBe("e-block-1");
  });

  it("merges on backspace at offset 0 into replace_block + delete_block", () => {
    const { doc } = htmlToDoc(
      '<p data-block-id="b1">Hello</p><p data-block-id="b2"> world.</p>',
      7
    );
    const merged = mergeBlockOps(doc, "b2", " world.", seqIds("m"));
    expect(merged.ops.map((op) => op.type)).toEqual(["replace_block", "delete_block"]);
    expect(merged.ops[0]).toMatchObject({
      type: "replace_block",
      blockId: "b1",
      baseRevision: 7,
      html: '<p data-block-id="b1">Hello world.</p>',
    });
    expect(merged.ops[1]).toMatchObject({
      type: "delete_block",
      blockId: "b2",
      baseRevision: 8,
    });
    expect(merged.focusBlockId).toBe("b1");
    expect(merged.focusOffset).toBe("Hello".length);
    expect(mergeBlockOps(doc, "b1").ops).toEqual([]);
  });

  it("serializes headings and quotes without flattening the tag", () => {
    expect(
      serializeBlockHtml({ id: "h", html: "<h3 data-block-id=\"h\">Old</h3>" }, "New")
    ).toBe('<h3 data-block-id="h">New</h3>');
    expect(
      serializeBlockHtml({ id: "q", html: "<blockquote data-block-id=\"q\">Old</blockquote>" }, "New")
    ).toBe('<blockquote data-block-id="q">New</blockquote>');
  });
});
