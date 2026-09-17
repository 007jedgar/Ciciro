import type { ChapterSnapshot } from "../lib/db";
import { applyRemoteOps, opTouchesBlock, preserveFocusedBlocks, rebaseRejectedOp } from "../lib/sync-merge";
import type { RemoteChapterOp } from "../lib/sync-merge";

const chapter: ChapterSnapshot = {
  id: "c1",
  projectId: "p1",
  title: "One",
  order: 0,
  content: '<p data-block-id="b1">Hello.</p><p data-block-id="b2">World.</p>',
  summary: "",
  status: "draft",
  wordCount: 2,
  revision: 2,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function replaceOp(seq: number, blockId: string, text: string): RemoteChapterOp {
  return {
    opId: `op-${seq}`,
    chapterId: "c1",
    baseRevision: seq - 1,
    actor: "user",
    type: "replace_block",
    blockId,
    html: `<p data-block-id="${blockId}">${text}</p>`,
    seq,
  };
}

describe("focused-block skip on remote apply", () => {
  it("applies ops to other blocks and leaves the focused TextInput's block alone", () => {
    const result = applyRemoteOps(
      chapter,
      [replaceOp(3, "b1", "Hello from desk."), replaceOp(4, "b2", "World from desk.")],
      { skipBlockIds: ["b1"] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe(1);
    expect(result.applied).toBe(1);
    expect(result.chapter.revision).toBe(4);
    expect(result.chapter.content).toContain("Hello.</p>");
    expect(result.chapter.content).not.toContain("Hello from desk.");
    expect(result.chapter.content).toContain("World from desk.");
  });

  it("preserves focused HTML when a refetch snapshot would otherwise clobber it", () => {
    const remote: ChapterSnapshot = {
      ...chapter,
      revision: 4,
      content: '<p data-block-id="b1">Hello from desk.</p><p data-block-id="b2">World from desk.</p>',
    };
    const kept = preserveFocusedBlocks(chapter, remote, ["b1"]);
    expect(kept.content).toContain("Hello.</p>");
    expect(kept.content).toContain("World from desk.");
    expect(kept.revision).toBe(4);
  });

  it("treats replace/delete of the focused id as touching that block", () => {
    expect(opTouchesBlock(replaceOp(3, "b1", "X"), "b1")).toBe(true);
    expect(opTouchesBlock(replaceOp(3, "b2", "X"), "b1")).toBe(false);
    expect(
      opTouchesBlock({ opId: "d", baseRevision: 2, actor: "user", type: "delete_block", blockId: "b1" }, "b1")
    ).toBe(true);
  });
});

describe("rebase keeps the author's prose", () => {
  const head = {
    ...chapter,
    revision: 9,
    content: '<p data-block-id="b1">Hello.</p><p data-block-id="b2">World.</p>',
  };

  it("restamps a stale op onto the server head", () => {
    const { retry } = rebaseRejectedOp({
      op: replaceOp(3, "b2", "World, revised."),
      reason: "stale",
      chapter: head,
    });
    expect(retry).toMatchObject({ type: "replace_block", blockId: "b2", baseRevision: 9 });
  });

  it("appends a replace aimed at a paragraph the server no longer has", () => {
    const { retry } = rebaseRejectedOp({
      op: replaceOp(3, "gone", "Typed into a deleted paragraph."),
      reason: "missing_block",
      chapter: head,
    });
    expect(retry).toMatchObject({
      type: "insert_block",
      afterBlockId: "b2",
      blockId: "gone",
      baseRevision: 9,
    });
    expect((retry as { html: string }).html).toContain("Typed into a deleted paragraph.");
  });

  it("re-anchors an insert whose anchor vanished and drops a delete of a vanished block", () => {
    const insert: RemoteChapterOp = {
      opId: "i",
      chapterId: "c1",
      baseRevision: 3,
      actor: "user",
      type: "insert_block",
      afterBlockId: "gone",
      blockId: "new",
      html: '<p data-block-id="new">New paragraph.</p>',
      seq: 4,
    };
    expect(rebaseRejectedOp({ op: insert, reason: "missing_block", chapter: head }).retry).toMatchObject({
      type: "insert_block",
      afterBlockId: "b2",
      blockId: "new",
    });
    expect(
      rebaseRejectedOp({
        op: { opId: "d", baseRevision: 3, actor: "user", type: "delete_block", blockId: "gone" },
        reason: "missing_block",
        chapter: head,
      }).retry
    ).toBeNull();
    expect(
      rebaseRejectedOp({ op: replaceOp(3, "gone", "   "), reason: "missing_block", chapter: head }).retry
    ).toBeNull();
  });
});
