import { insertDraftOps, insertionKey } from "../lib/chat-insert";

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

describe("insertionKey", () => {
  it("keys a draft on turn plus segment index", () => {
    expect(insertionKey("turn-1", 2)).toBe("turn-1:2");
  });
});
