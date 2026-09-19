import { htmlToDoc } from "../lib/manuscript";
import {
  applyOpsToDoc,
  appendParagraphsOps,
  mergeBlockOps,
  newParagraphHtml,
  replaceBlockOps,
  serializeBlockHtml,
  splitAtOffset,
  splitBlockOps,
  splitOrInsertBlockOps,
  tagOfHtml,
  takeReturnSplit,
  backspaceAtStartOps,
} from "../lib/block-editor";
import { takePlaceholderBlockId } from "../lib/editor-session";

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

    const atStart = splitBlockOps(doc, "b1", "", "Hello world.", seqIds("t"));
    expect(atStart.focusBlockId).toBe("b1");

    const { doc: blank } = htmlToDoc('<p data-block-id="e1"></p>', 1);
    const another = splitBlockOps(blank, "e1", "", "", seqIds("n"));
    expect(another.ops).toHaveLength(1);
    expect(another.ops[0]).toMatchObject({ type: "insert_block", afterBlockId: "e1" });
    expect(another.focusBlockId).toBe("n-block-1");
  });

  it("turns a Return character into a left/right paragraph split", () => {
    expect(takeReturnSplit("Hello world.")).toBeNull();
    expect(takeReturnSplit("Hello\nworld.")).toEqual({ left: "Hello", right: "world." });
    expect(takeReturnSplit("Hello\n\nworld.")).toEqual({ left: "Hello", right: "world." });
    expect(splitAtOffset("Hello world.", 5)).toEqual({ left: "Hello", right: " world." });
  });

  it("still inserts a new paragraph when Return hits a block the committed HTML does not know", () => {
    const { doc } = htmlToDoc('<p data-block-id="b1">Hello world.</p>', 2);
    const missing = splitOrInsertBlockOps(doc, "ghost", "Hello world.", "", seqIds("g"));
    expect(missing.ops).toHaveLength(1);
    expect(missing.ops[0]).toMatchObject({
      type: "insert_block",
      afterBlockId: "b1",
      html: newParagraphHtml("g-block-1", ""),
    });
    expect(missing.focusBlockId).toBe("g-block-1");

    const empty = splitOrInsertBlockOps(
      { revision: 0, blocks: [] },
      "draft-block",
      "Hello.",
      "Next.",
      seqIds("z")
    );
    expect(empty.ops.map((op) => op.type)).toEqual(["insert_block", "insert_block"]);
    expect(empty.focusBlockId).toBe("z-block-3");
  });

  it("does not reuse the empty-chapter placeholder for the paragraph Return inserts", () => {
    const empty = { current: "draft-block" as string | null };
    let ops = 0;
    const result = splitOrInsertBlockOps(
      { revision: 0, blocks: [] },
      "draft-block",
      "Hello.",
      "",
      {
        createBlockId: () => takePlaceholderBlockId(empty),
        createOpId: () => `op-${++ops}`,
      }
    );
    const ids = result.ops
      .filter((op): op is Extract<(typeof result.ops)[number], { type: "insert_block" }> => op.type === "insert_block")
      .map((op) => op.blockId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("draft-block");
    expect(ids[1]).not.toBe("draft-block");
    expect(new Set(ids).size).toBe(2);
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

  it("collapses empty paragraphs above the caret then merges into the last real sentence", () => {
    const { doc } = htmlToDoc(
      '<p data-block-id="b1">Was that the airflow lady?</p><p data-block-id="e1"></p><p data-block-id="e2"></p><p data-block-id="b2">"Yes," I said.</p>',
      4
    );
    const result = backspaceAtStartOps(doc, "b2", '"Yes," I said.', seqIds("k"));
    expect(result.ops.map((op) => op.type)).toEqual(["delete_block", "delete_block"]);
    expect(result.ops[0]).toMatchObject({ type: "delete_block", blockId: "e2" });
    expect(result.ops[1]).toMatchObject({ type: "delete_block", blockId: "e1" });
    expect(result.focusBlockId).toBe("b2");
    expect(result.focusOffset).toBe(0);
    const afterGap = applyOpsToDoc(doc, result.ops);
    const merged = backspaceAtStartOps(afterGap, "b2", '"Yes," I said.', seqIds("m"));
    expect(merged.ops.map((op) => op.type)).toEqual(["replace_block", "delete_block"]);
    expect(merged.focusBlockId).toBe("b1");
    expect(merged.focusOffset).toBe("Was that the airflow lady?".length);
  });

  it("serializes headings and quotes without flattening the tag", () => {
    expect(
      serializeBlockHtml({ id: "h", html: "<h3 data-block-id=\"h\">Old</h3>" }, "New")
    ).toBe('<h3 data-block-id="h">New</h3>');
    expect(
      serializeBlockHtml({ id: "q", html: "<blockquote data-block-id=\"q\">Old</blockquote>" }, "New")
    ).toBe('<blockquote data-block-id="q">New</blockquote>');
  });

  it("appends AI paragraphs after the last block", () => {
    const { doc } = htmlToDoc('<p data-block-id="b1">Night.</p>', 3);
    const ops = appendParagraphsOps(doc, ["Dawn."], { ...seqIds("a"), actor: "ai" });
    expect(ops).toEqual([
      {
        opId: "a-op-2",
        baseRevision: 3,
        actor: "ai",
        type: "insert_block",
        afterBlockId: "b1",
        blockId: "a-block-1",
        html: newParagraphHtml("a-block-1", "Dawn."),
      },
    ]);
  });
});

describe("htmlToDoc without a crypto global", () => {
  // Hermes has no `crypto`, and a bare reference to one throws rather than
  // coming back undefined. Node hands tests a `crypto`, which is exactly why
  // this went out working and failed the moment it ran on a phone.
  const realCrypto = globalThis.crypto;

  beforeEach(() => {
    // @ts-expect-error -- standing in for a runtime that has no crypto at all.
    delete globalThis.crypto;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: realCrypto,
      configurable: true,
      writable: true,
    });
  });

  it("still stamps every block with an id of its own", () => {
    const { doc } = htmlToDoc("<p>One.</p><p>Two.</p><p>Three.</p>", 1);
    expect(doc.blocks).toHaveLength(3);
    for (const block of doc.blocks) expect(block.id).toBeTruthy();
    expect(new Set(doc.blocks.map((b) => b.id)).size).toBe(3);
  });
});
