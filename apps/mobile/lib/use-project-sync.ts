import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { AppState, Platform } from "react-native";
import { queryKeys } from "./api/keys";
import { queryClient } from "./api/query";
import type { ProjectDetail, SyncOp } from "./api/types";
import type { ReplicaReadingPosition } from "./db";
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
} from "./sync-engine";
import { noteWritingStroke, noteWritingWords } from "./writing-day-session";
import { positiveWordDelta } from "./writing-day";

const webReplica = createMemoryReplica();

function defaultReplica(): ReplicaStore {
  return Platform.OS === "web" ? webReplica : sqliteReplica;
}

function writeChaptersToCache(projectId: string, result: SyncCycleResult): void {
  queryClient.setQueryData<ProjectDetail>(queryKeys.projects.detail(projectId), (current) => {
    if (!current) return current;
    const byId = new Map(result.chapters.map((chapter) => [chapter.id, chapter]));
    return {
      ...current,
      chapters: current.chapters.map((chapter) => {
        const next = byId.get(chapter.id);
        if (!next) return chapter;
        return {
          ...chapter,
          content: next.content,
          revision: next.revision,
          wordCount: next.wordCount,
          title: next.title,
          summary: next.summary,
          status: next.status,
        };
      }),
    };
  });
  queryClient.setQueryData(queryKeys.projects.position(projectId), {
    position: result.position
      ? {
          projectId: result.position.projectId,
          chapterId: result.position.chapterId,
          blockId: result.position.blockId,
          offset: result.position.offset,
          updatedAt: result.position.updatedAt,
        }
      : null,
  });
}

export function useProjectSync(
  projectId: string,
  opts?: {
    store?: ReplicaStore;
    api?: SyncApi;
    skipBlockIdRef?: MutableRefObject<string | null>;
  }
) {
  const { user } = useSession();
  const store = opts?.store ?? defaultReplica();
  const api = opts?.api ?? defaultSyncApi;
  const [position, setPosition] = useState<ReplicaReadingPosition | null>(null);
  const [syncing, setSyncing] = useState(false);
  const running = useRef<Promise<SyncCycleResult | null> | null>(null);

  const skipOpts = useCallback(() => {
    const id = opts?.skipBlockIdRef?.current;
    return id ? { skipBlockIds: [id] } : undefined;
  }, [opts?.skipBlockIdRef]);

  const run = useCallback(
    async (mode: "auto" | "pull" | "push" = "auto"): Promise<SyncCycleResult | null> => {
      if (!user || !projectId) return null;
      if (running.current) return running.current;
      setSyncing(true);
      const scope = { projectId, userId: user.id };
      const skip = skipOpts();
      const work = (async () => {
        const result =
          mode === "pull"
            ? await pullProject(store, scope, api, skip)
            : mode === "push"
              ? await pushProject(store, scope, api, skip)
              : await syncProject(store, scope, api, skip);
        setPosition(result.position);
        writeChaptersToCache(projectId, result);
        return result;
      })()
        .catch(() => null)
        .finally(() => {
          running.current = null;
          setSyncing(false);
        });
      running.current = work;
      return work;
    },
    [api, projectId, skipOpts, store, user]
  );

  useEffect(() => {
    void run("auto");
    return listenWhenActive(AppState, () => {
      void run("auto");
    });
  }, [run]);

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
          return {
            ...current,
            chapters: current.chapters.map((chapter) =>
              chapter.id === snapshot.id
                ? {
                    ...chapter,
                    content: snapshot.content,
                    revision: snapshot.revision,
                    wordCount: snapshot.wordCount,
                  }
                : chapter
            ),
          };
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
      const row = await enqueuePosition(store, { projectId, userId: user.id }, next);
      noteWritingStroke();
      setPosition(row);
      void run("push");
    },
    [projectId, run, store, user]
  );

  return useMemo(
    () => ({
      position,
      syncing,
      syncNow: () => run("auto"),
      pullNow: () => run("pull"),
      recordOp,
      recordBible,
      recordPosition,
    }),
    [position, recordBible, recordOp, recordPosition, run, syncing]
  );
}
