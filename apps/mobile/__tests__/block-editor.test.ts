import { htmlToDoc } from "../lib/manuscript";
import {
  appendParagraphsOps,
  newParagraphHtml,
  replaceBlockOps,
  serializeBlockHtml,
  tagOfHtml,
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
});
