import { createMemoryReplica } from "../lib/replica-memory";
import { pullProject, pushProject, recordChapterOp, resetSyncLocks, type SyncApi } from "../lib/sync-engine";
import { rebaseRejectedGroup } from "../lib/sync-merge";
import { asOpGroup, docHash, type ManuscriptOp } from "../lib/manuscript";
import type { Chapter, SyncAfter, SyncPushRequest, SyncResult } from "../lib/api/types";

function emptyResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    accepted: [],
    rejected: [],
    bibleRejected: [],
    chapters: [],
    bible: [],
    position: null,
    ops: [],
    bibleFiles: [],
    ...overrides,
  };
}

const chapter: Chapter = {
  id: "c1",
  projectId: "p1",
  title: "One",
  order: 0,
  content: '<p data-block-id="b1">One two three four.</p>',
  summary: "",
  status: "draft",
  wordCount: 4,
  revision: 1,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const scope = { projectId: "p1", userId: "u1" };

function groupedReplaceAndInsert(): ManuscriptOp[] {
  return asOpGroup(
    [
      {
        opId: "op-1",
        baseRevision: 1,
        actor: "user",
        type: "replace_block",
        blockId: "b1",
        html: '<p data-block-id="b1">One two</p>',
      },
      {
        opId: "op-2",
        baseRevision: 1,
        actor: "user",
        type: "insert_block",
        afterBlockId: "b1",
        blockId: "b2",
        html: '<p data-block-id="b2">three four.</p>',
      },
    ],
    "g1"
  );
}

function groupedReplaceAndDelete(): ManuscriptOp[] {
  return asOpGroup(
    [
      {
        opId: "op-1",
        baseRevision: 1,
        actor: "user",
        type: "replace_block",
        blockId: "b1",
        html: '<p data-block-id="b1">One.Two.</p>',
      },
      {
        opId: "op-2",
        baseRevision: 1,
        actor: "user",
        type: "delete_block",
        blockId: "b2",
      },
    ],
    "g1"
  );
}

describe("grouped ops on the phone", () => {
  beforeEach(() => {
    resetSyncLocks();
  });

  it("puts a replace and insert under one group", () => {
    const ops = groupedReplaceAndInsert();

    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe("replace_block");
    expect(ops[1].type).toBe("insert_block");
    const groups = new Set(ops.map((op) => op.groupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });

  it("puts a replace and delete under one group", () => {
    const ops = groupedReplaceAndDelete();

    expect(ops.map((op) => op.type)).toEqual(["replace_block", "delete_block"]);
    expect(ops[0].groupId).toBe(ops[1].groupId);
    expect(ops[0].groupId).toBeTruthy();
  });

  it("rebases a whole rejected group onto the server head in one piece", () => {
    // The phone split a paragraph at revision 1; the desk moved the chapter to
    // revision 4 first, so the group came back stale. Nothing about the split
    // is impossible at the new head — it just has to be restamped as a unit.
    const ops = groupedReplaceAndInsert();

    const { retry } = rebaseRejectedGroup({
      ops,
      reason: "stale",
      chapter: { ...chapter, revision: 4 },
    });

    expect(retry).toHaveLength(2);
    expect(retry.map((op) => op.baseRevision)).toEqual([4, 5]);
    expect(retry.map((op) => op.opId)).toEqual(ops.map((op) => op.opId));
    expect(new Set(retry.map((op) => op.groupId)).size).toBe(1);
  });

  it("salvages a group it cannot replay rather than dropping the author's prose", () => {
    // The server no longer has b1 at all — the desk deleted that paragraph.
    // The split cannot replay in place, but the words the author typed are
    // still theirs, so they land as trailing paragraphs instead of vanishing.
    const ops = groupedReplaceAndInsert();

    const { retry } = rebaseRejectedGroup({
      ops,
      reason: "missing_block",
      chapter: {
        ...chapter,
        content: '<p data-block-id="b-other">Something else entirely.</p>',
        revision: 6,
      },
    });

    const text = retry.map((op) => ("html" in op ? op.html : "")).join(" ");
    expect(text).toContain("three four.");
    // Salvaged ops stand alone: insisting they stay atomic would throw away
    // the half that could still land.
    expect(retry.every((op) => (op.groupId ?? null) === null)).toBe(true);
  });

  it("drops a rejected group's pending rows and enqueues only the rebased ones", async () => {
    const store = createMemoryReplica();
    await store.upsertChapter({ ...chapter, archivedAt: null });
    const ops = groupedReplaceAndInsert();
    for (const op of ops) {
      await recordChapterOp(store, "p1", { ...op, chapterId: "c1" });
    }
    expect(await store.listPendingOps("p1")).toHaveLength(2);

    let pushes = 0;
    const api: SyncApi = {
      listChapters: async () => [{ ...chapter, revision: 4 }],
      pull: async () => emptyResult({ chapters: [{ id: "c1", revision: 4, wordCount: 4 }] }),
      push: async (body: SyncPushRequest) => {
        pushes += 1;
        if (pushes === 1) {
          return emptyResult({
            rejected: (body.ops ?? []).map((op) => ({
              op,
              reason: "stale" as const,
              chapter: { ...chapter, revision: 4 },
            })),
            chapters: [{ id: "c1", revision: 4, wordCount: 4 }],
          });
        }
        return emptyResult({
          accepted: (body.ops ?? []).map((op, index) => ({ op, seq: 5 + index })),
          chapters: [{ id: "c1", revision: 6, wordCount: 4 }],
        });
      },
    };

    const result = await pushProject(store, scope, api);
    expect(result.rebased).toBe(2);
    expect(result.dropped).toBe(0);
    expect(await store.listPendingOps("p1")).toHaveLength(0);
  });

  it("sends a hash for a clean chapter and none for one holding unpushed ops", async () => {
    const store = createMemoryReplica();
    await store.upsertChapter({ ...chapter, archivedAt: null });
    await store.upsertChapter({ ...chapter, id: "c2", content: "<p>Clean.</p>", archivedAt: null });

    const seen: SyncAfter[] = [];
    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async (_projectId, after) => {
        seen.push(after ?? {});
        return emptyResult();
      },
      push: async () => emptyResult(),
    };

    await pullProject(store, scope, api);
    expect(seen[0].hashes).toMatchObject({
      c1: docHash(chapter.content),
      c2: docHash("<p>Clean.</p>"),
    });

    const op: ManuscriptOp = {
      opId: "pending-1",
      baseRevision: 1,
      actor: "user",
      type: "replace_block",
      blockId: "b1",
      html: '<p data-block-id="b1">One two three five.</p>',
    };
    await recordChapterOp(store, "p1", { ...op, chapterId: "c1" });
    await pullProject(store, scope, api);

    // c1 now sits at a revision the server has never heard of, so there is
    // nothing meaningful to compare; c2 is still confirmed.
    expect(seen[1].hashes).not.toHaveProperty("c1");
    expect(seen[1].hashes).toHaveProperty("c2");
  });

  it("leaves hashes off the pull that rides along with a push", async () => {
    // A push happens on every keystroke flush. Asking the server to hash every
    // clean chapter that often would make it read the whole manuscript each
    // time; the divergence check belongs on the pull cycles instead.
    const store = createMemoryReplica();
    await store.upsertChapter({ ...chapter, archivedAt: null });

    const bodies: SyncPushRequest[] = [];
    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async () => emptyResult(),
      push: async (body: SyncPushRequest) => {
        bodies.push(body);
        return emptyResult({ chapters: [{ id: "c1", revision: 1, wordCount: 4 }] });
      },
    };

    await pushProject(store, scope, api);
    expect(bodies[0].after?.chapters).toMatchObject({ c1: 1 });
    expect(bodies[0].after?.hashes).toBeUndefined();
  });

  it("adopts the server's bytes when the hash check says the replica diverged", async () => {
    const store = createMemoryReplica();
    await store.upsertChapter({
      ...chapter,
      content: '<p data-block-id="b1">A sentence the server never had.</p>',
      archivedAt: null,
    });

    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async () =>
        emptyResult({
          chapters: [{ id: "c1", revision: 1, wordCount: 4 }],
          diverged: [
            {
              chapterId: "c1",
              revision: 1,
              clientHash: docHash('<p data-block-id="b1">A sentence the server never had.</p>'),
              serverHash: docHash(chapter.content),
              chapter,
            },
          ],
        }),
      push: async () => emptyResult(),
    };

    const result = await pullProject(store, scope, api);
    expect(result.healed).toBe(1);
    const local = await store.getChapter("c1");
    expect(docHash(local?.content ?? "")).toBe(docHash(chapter.content));
  });

  it("keeps the focused block while healing a divergence", async () => {
    const store = createMemoryReplica();
    const typing = '<p data-block-id="b1">One two three four five</p>';
    await store.upsertChapter({ ...chapter, content: typing, archivedAt: null });

    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async () =>
        emptyResult({
          chapters: [{ id: "c1", revision: 1, wordCount: 4 }],
          diverged: [
            {
              chapterId: "c1",
              revision: 1,
              clientHash: docHash(typing),
              serverHash: docHash(chapter.content),
              chapter,
            },
          ],
        }),
      push: async () => emptyResult(),
    };

    await pullProject(store, scope, api, { skipBlockIds: ["b1"] });
    const local = await store.getChapter("c1");
    expect(local?.content).toContain("One two three four five");
  });
});
