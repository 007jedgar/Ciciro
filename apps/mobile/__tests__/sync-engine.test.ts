import {
  createMemoryReplica,
} from "../lib/replica-memory";
import {
  listenWhenActive,
  pullProject,
  pushProject,
  recordBibleWrite,
  recordChapterOp,
  recordReadingPosition,
  resetSyncLocks,
  syncProject,
  type SyncApi,
} from "../lib/sync-engine";
import type { Chapter, ChapterOpRecord, SyncResult } from "../lib/api/types";

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
  content: '<p data-block-id="b-desk">The lantern was still burning.</p>',
  summary: "",
  status: "draft",
  wordCount: 5,
  revision: 1,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const deskOp: ChapterOpRecord = {
  opId: "desk-1",
  chapterId: "c1",
  projectId: "p1",
  seq: 1,
  baseRevision: 0,
  actor: "user",
  type: "insert_block",
  afterBlockId: null,
  blockId: "b-desk",
  html: '<p data-block-id="b-desk">The lantern was still burning.</p>',
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("mobile sync engine", () => {
  beforeEach(() => {
    resetSyncLocks();
  });

  it("pulls a desk edit and resume-at-sentence caret into the replica", async () => {
    const store = createMemoryReplica();
    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async () =>
        emptyResult({
          chapters: [{ id: "c1", revision: 1, wordCount: 5 }],
          position: {
            projectId: "p1",
            chapterId: "c1",
            blockId: "b-desk",
            offset: 4,
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
          ops: [deskOp],
        }),
      push: async () => emptyResult(),
    };

    const result = await pullProject(store, { projectId: "p1", userId: "u1" }, api);
    const local = await store.getChapter("c1");
    const position = await store.getPosition("u1", "p1");

    expect(local?.content).toContain("lantern was still burning");
    expect(local?.revision).toBe(1);
    expect(position).toMatchObject({
      chapterId: "c1",
      blockId: "b-desk",
      offset: 4,
    });
    expect(result.position?.offset).toBe(4);
  });

  it("applies later ops onto a stale replica without refetching when seq is contiguous", async () => {
    const store = createMemoryReplica();
    await store.upsertChapter({
      ...chapter,
      content: "",
      revision: 0,
      wordCount: 0,
    });
    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async (_id, after) => {
        expect(after?.chapters?.c1).toBe(0);
        return emptyResult({
          ops: [deskOp],
          chapters: [{ id: "c1", revision: 1, wordCount: 5 }],
          position: {
            projectId: "p1",
            chapterId: "c1",
            blockId: "b-desk",
            offset: 4,
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        });
      },
      push: async () => emptyResult(),
    };

    await pullProject(store, { projectId: "p1", userId: "u1" }, api);
    expect((await store.getChapter("c1"))?.content).toContain("still burning");
  });

  it("pushes queued ops, bible, and position and rebases a stale reject", async () => {
    const store = createMemoryReplica();
    await store.upsertChapter({
      ...chapter,
      content: '<p data-block-id="b1">Desk sentence.</p>',
      revision: 1,
    });

    await recordChapterOp(store, "p1", {
      opId: "phone-1",
      chapterId: "c1",
      baseRevision: 0,
      actor: "user",
      type: "replace_block",
      blockId: "b1",
      html: "<p>Phone overlay.</p>",
    });
    await recordBibleWrite(store, "p1", {
      path: "canon.md",
      revision: 0,
      content: "# Canon\nPhone note.\n",
    });
    await recordReadingPosition(
      store,
      { projectId: "p1", userId: "u1" },
      { chapterId: "c1", blockId: "b1", offset: 2 }
    );

    let pushes = 0;
    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async () => emptyResult(),
      push: async (body) => {
        pushes += 1;
        if (pushes === 1) {
          expect(body.ops).toHaveLength(1);
          expect(body.bible).toEqual([
            { path: "canon.md", revision: 0, content: "# Canon\nPhone note.\n" },
          ]);
          expect(body.position).toEqual({
            chapterId: "c1",
            blockId: "b1",
            offset: 2,
          });
          return emptyResult({
            rejected: [
              {
                op: body.ops![0],
                reason: "stale",
                chapter: {
                  ...chapter,
                  content: '<p data-block-id="b1">Desk sentence.</p>',
                  revision: 1,
                },
              },
            ],
            chapters: [{ id: "c1", revision: 1, wordCount: 2 }],
            bible: [{ path: "canon.md", revision: 1 }],
            bibleFiles: [{ path: "canon.md", content: "# Canon\nPhone note.\n", revision: 1 }],
            position: {
              projectId: "p1",
              chapterId: "c1",
              blockId: "b1",
              offset: 2,
              updatedAt: "2026-01-01T00:00:02.000Z",
            },
          });
        }
        expect(body.ops?.[0]?.baseRevision).toBe(1);
        return emptyResult({
          accepted: [{ op: body.ops![0], seq: 2 }],
          ops: [
            {
              ...body.ops![0],
              projectId: "p1",
              seq: 2,
              createdAt: "2026-01-01T00:00:03.000Z",
            },
          ],
          chapters: [{ id: "c1", revision: 2, wordCount: 2 }],
          position: {
            projectId: "p1",
            chapterId: "c1",
            blockId: "b1",
            offset: 2,
            updatedAt: "2026-01-01T00:00:03.000Z",
          },
        });
      },
    };

    const result = await pushProject(store, { projectId: "p1", userId: "u1" }, api);
    expect(pushes).toBe(2);
    expect(result.rebased).toBeGreaterThanOrEqual(1);
    expect((await store.getChapter("c1"))?.content).toContain("Phone overlay");
    expect(await store.listPendingOps("p1")).toHaveLength(0);
  });

  it("push-on-edit uses sync when pending work exists, otherwise pulls", async () => {
    const store = createMemoryReplica();
    let pulled = 0;
    let pushed = 0;
    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async () => {
        pulled += 1;
        return emptyResult({ chapters: [{ id: "c1", revision: 1, wordCount: 5 }] });
      },
      push: async () => {
        pushed += 1;
        return emptyResult();
      },
    };

    await syncProject(store, { projectId: "p1", userId: "u1" }, api);
    expect(pulled).toBe(1);
    expect(pushed).toBe(0);

    await recordChapterOp(store, "p1", {
      opId: "local-1",
      chapterId: "c1",
      baseRevision: 1,
      actor: "user",
      type: "replace_block",
      blockId: "b-desk",
      html: "<p>Local.</p>",
    });
    await syncProject(store, { projectId: "p1", userId: "u1" }, api);
    expect(pushed).toBe(1);
  });

  it("applies a chapter op to the replica before it is queued", async () => {
    const store = createMemoryReplica();
    await store.upsertChapter({
      ...chapter,
      content: '<p data-block-id="b-desk">The lantern was still burning.</p>',
      revision: 1,
    });
    await recordChapterOp(store, "p1", {
      opId: "phone-2",
      chapterId: "c1",
      baseRevision: 1,
      actor: "user",
      type: "replace_block",
      blockId: "b-desk",
      html: '<p data-block-id="b-desk">The lantern flickered.</p>',
    });
    expect((await store.getChapter("c1"))?.content).toContain("flickered");
    expect((await store.getChapter("c1"))?.revision).toBe(2);
    expect(await store.listPendingOps("p1")).toHaveLength(1);
  });

  it("notifies on AppState active", () => {
    const calls: string[] = [];
    let handler: ((status: string) => void) | null = null;
    const stop = listenWhenActive(
      {
        addEventListener: (_type, next) => {
          handler = next;
          return { remove: () => {
            handler = null;
          } };
        },
      },
      () => calls.push("active")
    );
    handler?.("background");
    handler?.("active");
    expect(calls).toEqual(["active"]);
    stop();
  });
});
