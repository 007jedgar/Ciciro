import type {
  Chapter,
  ChapterOpRecord,
  ReadingPosition,
  SyncAfter,
  SyncOp,
  SyncPushRequest,
  SyncResult,
} from "./api/types";
import { ciciro } from "./api/resources";
import type {
  ChapterSnapshot,
  ReplicaBibleFile,
  ReplicaChapterOp,
  ReplicaReadingPosition,
} from "./db";
import type { ManuscriptOp } from "./manuscript";
import { applyRemoteOps, rebaseRejectedOp } from "./sync-merge";
import { opFromPayload, payloadOf, type ReplicaStore } from "./replica-store";

export type SyncApi = {
  pull: (projectId: string, after?: SyncAfter) => Promise<SyncResult>;
  push: (body: SyncPushRequest) => Promise<SyncResult>;
  listChapters: (projectId: string) => Promise<Chapter[]>;
};

export const defaultSyncApi: SyncApi = {
  pull: (projectId, after) => ciciro.sync.pull(projectId, after),
  push: (body) => ciciro.sync.push(body),
  listChapters: (projectId) => ciciro.chapters.list(projectId),
};

export type SyncCycleResult = {
  position: ReplicaReadingPosition | null;
  chapters: ChapterSnapshot[];
  pulledOps: number;
  pushedOps: number;
  rebased: number;
  dropped: number;
};

export type SyncScope = {
  projectId: string;
  userId: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function iso(value: string | Date | undefined): string {
  if (!value) return nowIso();
  return typeof value === "string" ? value : value.toISOString();
}

export function toChapterSnapshot(chapter: Chapter): ChapterSnapshot {
  return {
    id: chapter.id,
    projectId: chapter.projectId,
    title: chapter.title,
    order: chapter.order,
    content: chapter.content,
    summary: chapter.summary,
    status: chapter.status,
    wordCount: chapter.wordCount,
    revision: chapter.revision,
    archivedAt: chapter.archivedAt ?? null,
    createdAt: iso(chapter.createdAt),
    updatedAt: iso(chapter.updatedAt),
  };
}

function snapshotFromRejected(chapter: Chapter, projectId: string): ChapterSnapshot {
  return toChapterSnapshot({ ...chapter, projectId: chapter.projectId || projectId });
}

async function localAfter(store: ReplicaStore, projectId: string): Promise<SyncAfter> {
  const chapters = await store.listChapters(projectId);
  const bible = await store.listBible(projectId);
  const after: SyncAfter = { chapters: {}, bible: {} };
  for (const chapter of chapters) {
    after.chapters![chapter.id] = chapter.revision;
  }
  for (const file of bible) {
    after.bible![file.path] = file.revision;
  }
  return after;
}

function replicaOpFromRemote(op: ChapterOpRecord): ReplicaChapterOp {
  const payload =
    op.type === "delete_block"
      ? JSON.stringify({ blockId: op.blockId })
      : op.type === "insert_block"
        ? JSON.stringify({
            blockId: op.blockId,
            html: op.html,
            afterBlockId: op.afterBlockId,
          })
        : JSON.stringify({ blockId: op.blockId, html: op.html });
  return {
    id: `${op.chapterId}:${op.opId}`,
    chapterId: op.chapterId,
    projectId: op.projectId,
    opId: op.opId,
    seq: op.seq,
    baseRevision: op.baseRevision,
    actor: op.actor,
    type: op.type,
    payload,
    createdAt: iso(op.createdAt),
  };
}

async function refetchChapter(
  store: ReplicaStore,
  api: SyncApi,
  projectId: string,
  chapterId: string
): Promise<ChapterSnapshot | null> {
  const listed = await api.listChapters(projectId);
  const found = listed.find((c) => c.id === chapterId);
  if (!found) return null;
  const snapshot = toChapterSnapshot(found);
  await store.upsertChapter(snapshot);
  return snapshot;
}

async function applyPulledOps(
  store: ReplicaStore,
  api: SyncApi,
  projectId: string,
  ops: ChapterOpRecord[]
): Promise<number> {
  const byChapter = new Map<string, ChapterOpRecord[]>();
  for (const op of ops) {
    const list = byChapter.get(op.chapterId) ?? [];
    list.push(op);
    byChapter.set(op.chapterId, list);
    await store.insertOp(replicaOpFromRemote(op));
  }

  let applied = 0;
  for (const [chapterId, chapterOps] of byChapter) {
    let snapshot = await store.getChapter(chapterId);
    if (!snapshot) {
      snapshot = await refetchChapter(store, api, projectId, chapterId);
    }
    if (!snapshot) continue;

    const result = applyRemoteOps(snapshot, chapterOps);
    if (result.ok) {
      await store.upsertChapter(result.chapter);
      applied += result.applied;
      continue;
    }
    const fresh = await refetchChapter(store, api, projectId, chapterId);
    if (fresh) {
      const retry = applyRemoteOps(fresh, chapterOps);
      if (retry.ok) {
        await store.upsertChapter(retry.chapter);
        applied += retry.applied;
      } else {
        await store.upsertChapter(fresh);
      }
    }
  }
  return applied;
}

async function applyBiblePull(
  store: ReplicaStore,
  projectId: string,
  files: SyncResult["bibleFiles"]
): Promise<void> {
  for (const file of files) {
    const local = await store.getBible(projectId, file.path);
    if (local && local.revision >= file.revision) continue;
    const row: ReplicaBibleFile = {
      id: local?.id ?? `${projectId}:${file.path}`,
      projectId,
      path: file.path,
      content: file.content,
      revision: file.revision,
      updatedAt: nowIso(),
      createdAt: local?.createdAt ?? nowIso(),
    };
    await store.upsertBible(row);
  }
}

async function applyPositionPull(
  store: ReplicaStore,
  scope: SyncScope,
  position: ReadingPosition | null
): Promise<ReplicaReadingPosition | null> {
  const pending = await store.getPendingPosition(scope.userId, scope.projectId);
  if (pending) {
    return {
      id: `${scope.userId}:${scope.projectId}`,
      userId: scope.userId,
      projectId: pending.projectId,
      chapterId: pending.chapterId,
      blockId: pending.blockId,
      offset: pending.offset,
      updatedAt: pending.updatedAt,
    };
  }
  if (!position) {
    return store.getPosition(scope.userId, scope.projectId);
  }
  const row: ReplicaReadingPosition = {
    id: `${scope.userId}:${scope.projectId}`,
    userId: scope.userId,
    projectId: position.projectId,
    chapterId: position.chapterId,
    blockId: position.blockId,
    offset: position.offset,
    updatedAt: iso(position.updatedAt),
  };
  await store.upsertPosition(row);
  return row;
}

async function applySyncResult(
  store: ReplicaStore,
  api: SyncApi,
  scope: SyncScope,
  result: SyncResult
): Promise<{ pulledOps: number; position: ReplicaReadingPosition | null }> {
  const pulledOps = await applyPulledOps(store, api, scope.projectId, result.ops);
  await applyBiblePull(store, scope.projectId, result.bibleFiles);
  const position = await applyPositionPull(store, scope, result.position);
  return { pulledOps, position };
}

export async function hasPending(
  store: ReplicaStore,
  scope: SyncScope
): Promise<boolean> {
  const [ops, bible, position] = await Promise.all([
    store.listPendingOps(scope.projectId),
    store.listPendingBible(scope.projectId),
    store.getPendingPosition(scope.userId, scope.projectId),
  ]);
  return ops.length > 0 || bible.length > 0 || position != null;
}

export async function recordChapterOp(
  store: ReplicaStore,
  projectId: string,
  op: SyncOp
): Promise<void> {
  await store.enqueueOp({
    opId: op.opId,
    chapterId: op.chapterId,
    projectId,
    payload: payloadOf(op),
    createdAt: nowIso(),
  });
}

export async function recordBibleWrite(
  store: ReplicaStore,
  projectId: string,
  write: { path: string; content: string; revision: number }
): Promise<void> {
  await store.upsertPendingBible({
    projectId,
    path: write.path,
    content: write.content,
    revision: write.revision,
    createdAt: nowIso(),
  });
}

export async function recordReadingPosition(
  store: ReplicaStore,
  scope: SyncScope,
  position: { chapterId: string; blockId: string; offset: number }
): Promise<ReplicaReadingPosition> {
  const updatedAt = nowIso();
  const row: ReplicaReadingPosition = {
    id: `${scope.userId}:${scope.projectId}`,
    userId: scope.userId,
    projectId: scope.projectId,
    chapterId: position.chapterId,
    blockId: position.blockId,
    offset: position.offset,
    updatedAt,
  };
  await store.upsertPosition(row);
  await store.upsertPendingPosition({
    userId: scope.userId,
    projectId: scope.projectId,
    chapterId: position.chapterId,
    blockId: position.blockId,
    offset: position.offset,
    updatedAt,
  });
  return row;
}

async function collectPushBody(
  store: ReplicaStore,
  scope: SyncScope
): Promise<SyncPushRequest> {
  const after = await localAfter(store, scope.projectId);
  const pendingOps = await store.listPendingOps(scope.projectId);
  const pendingBible = await store.listPendingBible(scope.projectId);
  const pendingPosition = await store.getPendingPosition(scope.userId, scope.projectId);
  const ops: SyncOp[] = pendingOps.map((row) => {
    const parsed = opFromPayload(row.payload);
    return { ...parsed, chapterId: row.chapterId };
  });
  return {
    projectId: scope.projectId,
    after,
    ops,
    bible: pendingBible.map((file) => ({
      path: file.path,
      revision: file.revision,
      content: file.content,
    })),
    position: pendingPosition
      ? {
          chapterId: pendingPosition.chapterId,
          blockId: pendingPosition.blockId,
          offset: pendingPosition.offset,
        }
      : undefined,
  };
}

async function handleRejected(
  store: ReplicaStore,
  scope: SyncScope,
  result: SyncResult,
  body: SyncPushRequest
): Promise<{ rebased: number; dropped: number }> {
  let rebased = 0;
  let dropped = 0;
  for (const rejected of result.rejected) {
    const snapshot = snapshotFromRejected(rejected.chapter, scope.projectId);
    await store.upsertChapter(snapshot);
    const { retry } = rebaseRejectedOp({
      op: rejected.op,
      reason: rejected.reason,
      chapter: snapshot,
    });
    await store.deletePendingOps([rejected.op.opId]);
    if (!retry) {
      dropped += 1;
      continue;
    }
    await store.enqueueOp({
      opId: retry.opId,
      chapterId: snapshot.id,
      projectId: scope.projectId,
      payload: payloadOf(retry),
      createdAt: nowIso(),
    });
    rebased += 1;
  }

  const rejectedBible = new Set(result.bibleRejected.map((file) => file.path));
  for (const rejected of result.bibleRejected) {
    await store.deletePendingBible(scope.projectId, rejected.path);
    dropped += 1;
  }
  for (const file of body.bible ?? []) {
    if (!rejectedBible.has(file.path)) {
      await store.deletePendingBible(scope.projectId, file.path);
    }
  }

  if (result.accepted.length > 0) {
    await store.deletePendingOps(result.accepted.map((item) => item.op.opId));
  }
  if (body.position) {
    await store.deletePendingPosition(scope.userId, scope.projectId);
  }
  return { rebased, dropped };
}

const inflight = new Map<string, Promise<SyncCycleResult>>();

export function resetSyncLocks(): void {
  inflight.clear();
}

async function finishCycle(
  store: ReplicaStore,
  scope: SyncScope,
  pulledOps: number,
  pushedOps: number,
  rebased: number,
  dropped: number,
  position: ReplicaReadingPosition | null
): Promise<SyncCycleResult> {
  const chapters = await store.listChapters(scope.projectId);
  return {
    position: position ?? (await store.getPosition(scope.userId, scope.projectId)),
    chapters,
    pulledOps,
    pushedOps,
    rebased,
    dropped,
  };
}

export async function pullProject(
  store: ReplicaStore,
  scope: SyncScope,
  api: SyncApi = defaultSyncApi
): Promise<SyncCycleResult> {
  const localChapters = await store.listChapters(scope.projectId);
  if (localChapters.length === 0) {
    const listed = await api.listChapters(scope.projectId);
    for (const chapter of listed) {
      await store.upsertChapter(toChapterSnapshot(chapter));
    }
  }
  const after = await localAfter(store, scope.projectId);
  const result = await api.pull(scope.projectId, after);
  const applied = await applySyncResult(store, api, scope, result);
  return finishCycle(store, scope, applied.pulledOps, 0, 0, 0, applied.position);
}

async function pushOnce(
  store: ReplicaStore,
  scope: SyncScope,
  api: SyncApi
): Promise<{ result: SyncResult; body: SyncPushRequest; rebased: number; dropped: number }> {
  const body = await collectPushBody(store, scope);
  const result = await api.push(body);
  const handled = await handleRejected(store, scope, result, body);
  await applySyncResult(store, api, scope, result);
  return { result, body, ...handled };
}

export async function pushProject(
  store: ReplicaStore,
  scope: SyncScope,
  api: SyncApi = defaultSyncApi
): Promise<SyncCycleResult> {
  const first = await pushOnce(store, scope, api);
  let rebased = first.rebased;
  let dropped = first.dropped;
  let last = first;
  if (first.rebased > 0) {
    last = await pushOnce(store, scope, api);
    rebased += last.rebased;
    dropped += last.dropped;
  }
  const position = await store.getPosition(scope.userId, scope.projectId);
  return finishCycle(
    store,
    scope,
    last.result.ops.length,
    first.body.ops?.length ?? 0,
    rebased,
    dropped,
    position
  );
}

export async function syncProject(
  store: ReplicaStore,
  scope: SyncScope,
  api: SyncApi = defaultSyncApi
): Promise<SyncCycleResult> {
  const existing = inflight.get(scope.projectId);
  if (existing) return existing;
  const run = (async () => {
    if (await hasPending(store, scope)) {
      return pushProject(store, scope, api);
    }
    return pullProject(store, scope, api);
  })().finally(() => {
    inflight.delete(scope.projectId);
  });
  inflight.set(scope.projectId, run);
  return run;
}

export type AppActiveListener = {
  addEventListener: (
    type: "change",
    handler: (status: string) => void
  ) => { remove: () => void };
};

/** Pull (or push-if-pending) whenever the app returns to the foreground. */
export function listenWhenActive(
  appState: AppActiveListener,
  onActive: () => void
): () => void {
  const sub = appState.addEventListener("change", (status) => {
    if (status === "active") onActive();
  });
  return () => sub.remove();
}
