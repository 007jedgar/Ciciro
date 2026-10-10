import { insertDraftOps, insertionKey } from "../lib/chat-insert";
import { elementOfHtml } from "../lib/manuscript-kind";

describe("insertDraftOps", () => {
  it("appends AI paragraph ops after the last block", () => {
    const ops = insertDraftOps(
      {
        id: "c1",
        content: '<p data-block-id="b1">Night fell.</p>',
        revision: 4,
      },
      "The lantern caught.\n\nShe did not turn."
    );
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      chapterId: "c1",
      actor: "ai",
      type: "insert_block",
      afterBlockId: "b1",
      baseRevision: 4,
    });
    expect(ops[0].html).toContain("The lantern caught.");
    expect(ops[1]).toMatchObject({
      chapterId: "c1",
      actor: "ai",
      type: "insert_block",
      baseRevision: 5,
    });
    expect(ops[1].afterBlockId).not.toBe("b1");
    expect(ops[1].html).toContain("She did not turn.");
  });

  it("inserts the first block into an empty chapter", () => {
    const ops = insertDraftOps({ id: "c1", content: "", revision: 0 }, "Once.");
    expect(ops).toEqual([
      expect.objectContaining({
        chapterId: "c1",
        actor: "ai",
        type: "insert_block",
        afterBlockId: null,
        baseRevision: 0,
        html: expect.stringContaining("Once."),
      }),
    ]);
  });
});

describe("insertDraftOps in a screenplay", () => {
  it("sorts the draft into elements", () => {
    const ops = insertDraftOps(
      { id: "c1", content: '<p data-block-id="b1" data-sp="scene-heading">INT. LAB - DAY</p>', revision: 1 },
      "Rain on glass.\n\nMARA\n(quietly)\nHe left.\n\nCUT TO:",
      "screenplay"
    );
    const elements = ops.map((op) => (op.type === "insert_block" ? elementOfHtml(op.html) : null));
    expect(elements).toEqual(["action", "character", "parenthetical", "dialogue", "transition"]);
    expect(ops[1]).toMatchObject({ chapterId: "c1", actor: "ai" });
    expect(ops[1].type === "insert_block" && ops[1].html).toContain('data-sp="character"');
    expect(ops[0].type === "insert_block" && ops[0].html).not.toContain("data-sp");
  });

  it("reads dialogue on from a cue the chapter ends on", () => {
    const ops = insertDraftOps(
      { id: "c1", content: '<p data-block-id="b1" data-sp="character">MARA</p>', revision: 0 },
      "Where is he?",
      "screenplay"
    );
    expect(ops.map((op) => (op.type === "insert_block" ? elementOfHtml(op.html) : null))).toEqual(["dialogue"]);
  });

  it("keeps the old one-paragraph-per-break shape outside a screenplay", () => {
    const ops = insertDraftOps({ id: "c1", content: "", revision: 0 }, "MARA\nHello.\n\nShe waits.", "novel");
    expect(ops).toHaveLength(2);
    expect(ops.every((op) => op.type === "insert_block" && !op.html.includes("data-sp"))).toBe(true);
  });
});

describe("insertionKey", () => {
  it("keys a draft on turn plus segment index", () => {
    expect(insertionKey("turn-1", 2)).toBe("turn-1:2");
  });
});
