import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { AppState, Platform } from "react-native";
import { queryKeys } from "./api/keys";
import { queryClient } from "./api/query";
import type { ProjectDetail, SyncOp } from "./api/types";
import type { ReplicaReadingPosition } from "./db";
import { assignChapterSlice, assignChaptersFromSnapshots, sameReadingPosition } from "./editor-session";
import { createMemoryReplica } from "./replica-memory";
import { sqliteReplica } from "./replica-sqlite";
import type { ReplicaStore } from "./replica-store";
import { useSession } from "./session";
import {
  defaultSyncApi,
  listenWhenActive,
  pullProject,
  pushProject,
  recordBibleWrite as enqueueBible,
  recordChapterOp as enqueueOp,
  recordReadingPosition as enqueuePosition,
  syncProject,
  toChapterSnapshot,
  type SyncApi,
  type SyncCycleResult,
  type SyncScope,
} from "./sync-engine";
import { listenChapterHeads, type ChapterHeadSubscription } from "./sync-poke";
import { noteWritingStroke, noteWritingWords } from "./writing-day-session";
import { positiveWordDelta } from "./writing-day";

const webReplica = createMemoryReplica();

function defaultReplica(): ReplicaStore {
  return Platform.OS === "web" ? webReplica : sqliteReplica;
}

/** A push outranks a pull, and either outranks the auto choice. */
function mergeMode(
  queued: "auto" | "pull" | "push" | null,
  incoming: "auto" | "pull" | "push"
): "auto" | "pull" | "push" {
  if (queued === "push" || incoming === "push") return "push";
  if (queued === "pull" || incoming === "pull") return "pull";
  return "auto";
}

function writeChaptersToCache(projectId: string, result: SyncCycleResult): void {
  queryClient.setQueryData<ProjectDetail>(queryKeys.projects.detail(projectId), (current) => {
    if (!current) return current;
    const chapters = assignChaptersFromSnapshots(current.chapters, result.chapters);
    if (chapters === current.chapters) return current;
    return { ...current, chapters };
  });
  queryClient.setQueryData(
    queryKeys.projects.position(projectId),
    (
      current:
        | {
            position: {
              projectId: string;
              chapterId: string;
              blockId: string;
              offset: number;
              updatedAt: string;
            } | null;
          }
        | undefined
    ) => {
      const next = result.position
        ? {
            projectId: result.position.projectId,
            chapterId: result.position.chapterId,
            blockId: result.position.blockId,
            offset: result.position.offset,
            updatedAt: result.position.updatedAt,
          }
        : null;
      if (sameReadingPosition(current?.position, next) && (current?.position?.updatedAt ?? null) === (next?.updatedAt ?? null)) {
        return current;
      }
      if (!current && !next) return current;
      return { position: next };
    }
  );
}

export function useProjectSync(
  projectId: string,
  opts?: {
    store?: ReplicaStore;
    api?: SyncApi;
    listen?: ChapterHeadSubscription;
    skipBlockIdsRef?: MutableRefObject<string[]>;
  }
) {
  const { user } = useSession();
  const store = opts?.store ?? defaultReplica();
  const api = opts?.api ?? defaultSyncApi;
  const listen = opts?.listen ?? listenChapterHeads;
  const [position, setPosition] = useState<ReplicaReadingPosition | null>(null);
  const running = useRef<Promise<SyncCycleResult | null> | null>(null);
  const lastPlaceRef = useRef<{ chapterId: string; blockId: string; offset: number } | null>(null);
  if (position && !lastPlaceRef.current) {
    lastPlaceRef.current = {
      chapterId: position.chapterId,
      blockId: position.blockId,
      offset: position.offset,
    };
  }

  const skipOpts = useCallback(() => {
    const ids = opts?.skipBlockIdsRef?.current;
    return ids && ids.length > 0 ? { skipBlockIds: ids } : undefined;
  }, [opts?.skipBlockIdsRef]);

  const followUp = useRef<"auto" | "pull" | "push" | null>(null);

  const cycle = useCallback(
    async (mode: "auto" | "pull" | "push", scope: SyncScope): Promise<SyncCycleResult> => {
      const skip = skipOpts();
      const result =
        mode === "pull"
          ? await pullProject(store, scope, api, skip)
          : mode === "push"
            ? await pushProject(store, scope, api, skip)
            : await syncProject(store, scope, api, skip);
      setPosition((prev) => {
        if (sameReadingPosition(prev, result.position)) return prev;
        if (
          prev &&
          result.position &&
          prev.chapterId === result.position.chapterId &&
          prev.blockId === result.position.blockId
        ) {
          return prev;
        }
        return result.position;
      });
      writeChaptersToCache(projectId, result);
      return result;
    },
    [api, projectId, skipOpts, store]
  );

  /**
   * One cycle at a time per hook. A request that lands while a cycle is in
   * flight is not dropped and not started in parallel: exactly one follow-up
   * cycle runs after the current one, so an op enqueued mid-cycle is pushed
   * without waiting for the next keystroke or foreground.
   */
  const run = useCallback(
    async (mode: "auto" | "pull" | "push" = "auto"): Promise<SyncCycleResult | null> => {
      if (!user || !projectId) return null;
      const scope = { projectId, userId: user.id };
      if (running.current) {
        followUp.current = mergeMode(followUp.current, mode);
        return running.current;
      }
      const work = (async () => {
        let result: SyncCycleResult | null = null;
        let next: "auto" | "pull" | "push" | null = mode;
        while (next) {
          const current = next;
          followUp.current = null;
          result = await cycle(current, scope).catch(() => result);
          next = followUp.current;
        }
        return result;
      })().finally(() => {
        running.current = null;
      });
      running.current = work;
      return work;
    },
    [cycle, projectId, user]
  );

  useEffect(() => {
    void run("auto");
    return listenWhenActive(AppState, () => {
      void run("auto");
    });
  }, [run]);

  /**
   * Desk edits used to sit on the server until the author typed or brought the
   * app forward. The poke channel closes that gap: when a head moves past the
   * revision this client is holding, one pull cycle fetches it. The cache is
   * the synchronous view of what we already have — `run` keeps it current — so
   * a poke for a revision we already applied costs nothing.
   */
  useEffect(() => {
    if (!user || !projectId) return;
    return listen(projectId, {
      onBehind: () => {
        void run("pull");
      },
      localRevision: (chapterId) =>
        queryClient
          .getQueryData<ProjectDetail>(queryKeys.projects.detail(projectId))
          ?.chapters.find((chapter) => chapter.id === chapterId)?.revision,
    });
  }, [listen, projectId, run, user]);

  const recordOp = useCallback(
    async (op: SyncOp | SyncOp[]) => {
      const ops = Array.isArray(op) ? op : [op];
      if (ops.length === 0) return;
      const project = queryClient.getQueryData<ProjectDetail>(queryKeys.projects.detail(projectId));
      for (const item of ops) {
        if (!(await store.getChapter(item.chapterId))) {
          const chapter = project?.chapters.find((c) => c.id === item.chapterId);
          if (chapter) await store.upsertChapter(toChapterSnapshot(chapter));
        }
        const before = await store.getChapter(item.chapterId);
        await enqueueOp(store, projectId, item);
        const after = await store.getChapter(item.chapterId);
        noteWritingWords(positiveWordDelta(before?.wordCount ?? 0, after?.wordCount ?? 0));
      }
      const snapshot = await store.getChapter(ops[0].chapterId);
      if (snapshot) {
        queryClient.setQueryData<ProjectDetail>(queryKeys.projects.detail(projectId), (current) => {
          if (!current) return current;
          const chapters = current.chapters.map((chapter) =>
            chapter.id === snapshot.id
              ? assignChapterSlice(chapter, {
                  content: snapshot.content,
                  revision: snapshot.revision,
                  wordCount: snapshot.wordCount,
                })
              : chapter
          );
          if (chapters.every((chapter, index) => chapter === current.chapters[index])) return current;
          return { ...current, chapters };
        });
      }
      await run("push");
    },
    [projectId, run, store]
  );

  const recordBible = useCallback(
    async (write: { path: string; content: string; revision: number }) => {
      await enqueueBible(store, projectId, write);
      await run("push");
    },
    [projectId, run, store]
  );

  const recordPosition = useCallback(
    async (next: { chapterId: string; blockId: string; offset: number }) => {
      if (!user) return;
      if (sameReadingPosition(lastPlaceRef.current, next)) return;
      const row = await enqueuePosition(store, { projectId, userId: user.id }, next);
      noteWritingStroke();
      lastPlaceRef.current = next;
      if (!position || position.chapterId !== row.chapterId) {
        setPosition(row);
      }
    },
    [position, projectId, store, user]
  );

  /** Push queued chapter edits and report whether any are still unsent. */
  const flushEdits = useCallback(async (): Promise<boolean> => {
    if (!user || !projectId) return false;
    await run("push");
    return (await store.listPendingOps(projectId)).length === 0;
  }, [projectId, run, store, user]);

  return useMemo(
    () => ({
      position,
      syncing: false,
      syncNow: () => run("auto"),
      flushEdits,
      pullNow: () => run("pull"),
      recordOp,
      recordBible,
      recordPosition,
    }),
    [flushEdits, position, recordBible, recordOp, recordPosition, run]
  );
}
