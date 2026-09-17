import { act, renderHook, waitFor } from "@testing-library/react-native";
import { createMemoryReplica } from "../lib/replica-memory";
import type { SyncApi } from "../lib/sync-engine";
import type { Chapter, SyncPushRequest, SyncResult } from "../lib/api/types";
import { queryClient } from "../lib/api/query";
import { queryKeys } from "../lib/api/keys";
import { useProjectSync } from "../lib/use-project-sync";

jest.mock("../lib/session", () => ({
  useSession: () => ({ user: { id: "u1", email: "u@example.com", name: "U" }, ready: true }),
}));

const chapter: Chapter = {
  id: "c1",
  projectId: "p1",
  title: "One",
  order: 0,
  content: '<p data-block-id="b1">Hello.</p>',
  summary: "",
  status: "draft",
  wordCount: 1,
  revision: 1,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function result(overrides: Partial<SyncResult> = {}): SyncResult {
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

describe("useProjectSync cycle coalescing", () => {
  afterEach(() => queryClient.clear());

  it("pushes an op recorded while a cycle is in flight instead of skipping it", async () => {
    const store = createMemoryReplica();
    await store.upsertChapter({ ...chapter, projectId: "p1" });
    queryClient.setQueryData(queryKeys.projects.detail("p1"), { id: "p1", chapters: [chapter] });

    const releases: Array<() => void> = [];
    const bodies: SyncPushRequest[] = [];
    let revision = 1;
    const api: SyncApi = {
      listChapters: async () => [chapter],
      pull: async () => result({ chapters: [{ id: "c1", revision, wordCount: 1 }] }),
      push: (body) =>
        new Promise((resolve) => {
          bodies.push(body);
          releases.push(() => {
            const accepted = (body.ops ?? []).map((op) => ({ op, seq: ++revision }));
            resolve(result({ accepted, chapters: [{ id: "c1", revision, wordCount: 1 }] }));
          });
        }),
    };

    const { result: hook, unmount } = renderHook(() => useProjectSync("p1", { store, api }));
    // The mount cycle is a pull; let it finish so the push path starts clean.
    await waitFor(() => expect(revision).toBe(1));

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = hook.current.recordOp({
        opId: "op-1",
        chapterId: "c1",
        baseRevision: 1,
        actor: "user",
        type: "replace_block",
        blockId: "b1",
        html: '<p data-block-id="b1">Hello there.</p>',
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(bodies).toHaveLength(1));

    // Second commit lands while the first push is still on the wire.
    await act(async () => {
      second = hook.current.recordOp({
        opId: "op-2",
        chapterId: "c1",
        baseRevision: 2,
        actor: "user",
        type: "replace_block",
        blockId: "b1",
        html: '<p data-block-id="b1">Hello there, friend.</p>',
      });
      await Promise.resolve();
    });
    expect(bodies).toHaveLength(1);

    // Releasing the first push lets the follow-up cycle carry op-2 out.
    await act(async () => {
      releases[0]();
    });
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].ops?.map((op) => op.opId)).toEqual(["op-2"]);

    await act(async () => {
      releases[1]();
      await Promise.all([first, second]);
    });
    expect(await store.listPendingOps("p1")).toHaveLength(0);
    unmount();
  });
});
