import { htmlToDoc } from "../lib/manuscript";
import {
  appendParagraphsOps,
  applyOpsToDoc,
  moveSceneOps,
  newParagraphHtml,
  replaceBlockOps,
  serializeBlockHtml,
  setBlockElementOps,
  speechOfBlock,
  tagOfHtml,
  toggleDualOps,
} from "../lib/block-editor";

function seqIds(prefix: string) {
  let n = 0;
  return {
    createOpId: () => `${prefix}-op-${++n}`,
    createBlockId: () => `${prefix}-block-${++n}`,
  };
}

describe("block editor", () => {
  it("turns a text replace into a replace_block that keeps the original tag", () => {
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

  it("serializes headings and quotes without flattening the tag", () => {
    expect(
      serializeBlockHtml({ id: "h", html: '<h3 data-block-id="h">Old</h3>' }, "New")
    ).toBe('<h3 data-block-id="h">New</h3>');
    expect(
      serializeBlockHtml({ id: "q", html: '<blockquote data-block-id="q">Old</blockquote>' }, "New")
    ).toBe('<blockquote data-block-id="q">New</blockquote>');
  });

  it("keeps inline marks when the author keeps typing", () => {
    expect(
      serializeBlockHtml({ id: "b", html: '<p data-block-id="b"><strong>Old</strong></p>' }, "New")
    ).toBe('<p data-block-id="b"><strong>New</strong></p>');
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

  it("keeps an element a newer client wrote across a text edit", () => {
    const { doc } = htmlToDoc('<p data-block-id="a" data-sp="centered">THE END</p>', 3);
    const [op] = replaceBlockOps(doc, "a", "THE END.", seqIds("t"));
    expect(op).toMatchObject({ html: '<p data-block-id="a" data-sp="centered">THE END.</p>' });
  });

  it("sets a screenplay element with one replace_block, and keeps it across a text edit", () => {
    const { doc } = htmlToDoc('<p data-block-id="a">MARA</p>', 2);
    const ops = setBlockElementOps(doc, "a", "character", seqIds("e"));
    expect(ops).toEqual([
      {
        opId: "e-op-1",
        baseRevision: 2,
        actor: "user",
        type: "replace_block",
        blockId: "a",
        html: '<p data-block-id="a" data-sp="character">MARA</p>',
      },
    ]);
    expect(setBlockElementOps(doc, "a", "action")).toEqual([]);

    const { doc: cue } = htmlToDoc('<p data-block-id="a" data-sp="character">MARA</p>', 3);
    const edit = replaceBlockOps(cue, "a", "MARA (V.O.)", seqIds("t"));
    expect(edit[0]).toMatchObject({ html: '<p data-block-id="a" data-sp="character">MARA (V.O.)</p>' });
  });

  describe("dual dialogue", () => {
    const speeches =
      '<p data-block-id="a" data-sp="character">ANNA</p><p data-block-id="b" data-sp="dialogue">Go.</p>' +
      '<p data-block-id="c" data-sp="character">BEN</p><p data-block-id="d" data-sp="dialogue">No.</p>';

    it("flags the cue of the speech the caret is in, from any of its lines", () => {
      const { doc } = htmlToDoc(speeches, 5);
      for (const blockId of ["c", "d"]) {
        expect(toggleDualOps(doc, blockId, seqIds("d"))).toEqual([
          {
            opId: "d-op-1",
            baseRevision: 5,
            actor: "user",
            type: "replace_block",
            blockId: "c",
            html: '<p data-block-id="c" data-sp="character" data-sp-dual="1">BEN</p>',
          },
        ]);
      }
    });

    it("takes the speech back out of the pair again", () => {
      const { doc } = htmlToDoc(speeches.replace('data-block-id="c" data-sp="character"', 'data-block-id="c" data-sp="character" data-sp-dual="1"'), 5);
      expect(speechOfBlock(doc.blocks, "d")).toMatchObject({ cue: 2, pairable: true, on: true });
      expect(toggleDualOps(doc, "d", seqIds("u"))[0]).toMatchObject({
        blockId: "c",
        html: '<p data-block-id="c" data-sp="character">BEN</p>',
      });
    });

    it("does nothing for the first speech, a line that is not in a speech, or two speeches with a line between", () => {
      const { doc } = htmlToDoc(speeches, 5);
      expect(toggleDualOps(doc, "a")).toEqual([]);
      expect(toggleDualOps(doc, "b")).toEqual([]);
      const apart = htmlToDoc(
        '<p data-block-id="a" data-sp="character">ANNA</p><p data-block-id="b" data-sp="dialogue">Go.</p>' +
          '<p data-block-id="x">Rain falls.</p>' +
          '<p data-block-id="c" data-sp="character">BEN</p><p data-block-id="d" data-sp="dialogue">No.</p>',
        1
      ).doc;
      expect(speechOfBlock(apart.blocks, "d")).toMatchObject({ pairable: false, on: false });
      expect(toggleDualOps(apart, "d")).toEqual([]);
      expect(toggleDualOps(apart, "x")).toEqual([]);
      expect(toggleDualOps(apart, "missing")).toEqual([]);
    });
  });
});

describe("moveSceneOps", () => {
  const html =
    '<p data-block-id="a">Black.</p>' +
    '<p data-block-id="h1" data-sp="scene-heading">INT. A - DAY</p><p data-block-id="p1">One.</p>' +
    '<p data-block-id="h2" data-sp="scene-heading">INT. B - DAY</p><p data-block-id="p2">Two.</p>' +
    '<p data-block-id="h3" data-sp="scene-heading">INT. C - DAY</p><p data-block-id="p3">Three.</p>';

  function ids() {
    let n = 0;
    return {
      createOpId: () => `op-${++n}`,
      createBlockId: () => `new-${++n}`,
      createGroupId: () => "group",
    };
  }
  const texts = (doc: ReturnType<typeof htmlToDoc>["doc"]) => doc.blocks.map((b) => b.text);

  it("moves a scene with its blocks, as one group, leaving the rest alone", () => {
    const { doc } = htmlToDoc(html, 3);
    // scenes: 0 is the lead-in, 1..3 the headed scenes.
    const ops = moveSceneOps(doc, 1, 2, ids());
    expect(ops.every((op) => op.groupId === "group")).toBe(true);
    // Only the four blocks whose place changes are touched: the lead-in is not.
    expect(ops.filter((op) => op.type === "delete_block").map((op) => (op as { blockId: string }).blockId)).toEqual([
      "h1",
      "p1",
      "h2",
      "p2",
    ]);
    const moved = applyOpsToDoc(doc, ops);
    expect(texts(moved)).toEqual(["Black.", "INT. B - DAY", "Two.", "INT. A - DAY", "One.", "INT. C - DAY", "Three."]);
    expect(moved.blocks[1].html).toContain('data-sp="scene-heading"');
    expect(moved.blocks[0].id).toBe("a");
    expect(moved.blocks.map((b) => b.id).filter((id) => id.startsWith("new-"))).toHaveLength(4);
  });

  it("moves the last scene to the first place", () => {
    const { doc } = htmlToDoc(html, 3);
    const moved = applyOpsToDoc(doc, moveSceneOps(doc, 3, 1, ids()));
    expect(texts(moved)).toEqual(["Black.", "INT. C - DAY", "Three.", "INT. A - DAY", "One.", "INT. B - DAY", "Two."]);
  });

  it("does nothing for a move that goes nowhere", () => {
    const { doc } = htmlToDoc(html, 3);
    expect(moveSceneOps(doc, 2, 2)).toEqual([]);
    expect(moveSceneOps(doc, 0, 2)).toEqual([]);
  });
});
