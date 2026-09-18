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
import { docHash, type ManuscriptOp } from "./manuscript";
import {
  applyPendingOps,
  applyRemoteOps,
  preserveFocusedBlocks,
  rebaseRejectedGroup,
} from "./sync-merge";
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
  /** Chapters the server and this replica disagreed about, and overwrote. */
  healed: number;
};

export type SyncScope = {
  projectId: string;
  userId: string;
};

export type SyncSkipOptions = {
  skipBlockIds?: Iterable<string>;
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

/**
 * `withHashes` is off for the pull that rides along with a push. Hashing every
 * clean chapter means the server has to read every chapter's prose to answer,
 * and a push happens on every keystroke flush — so the divergence check rides
 * the pull cycles instead: foreground, a poke, an explicit refresh. A split
 * that the check would catch is still caught within seconds, and typing does
 * not drag the whole manuscript through a hash a second.
 */
async function localAfter(
  store: ReplicaStore,
  projectId: string,
  opts?: { withHashes?: boolean }
): Promise<SyncAfter> {
  const chapters = await store.listChapters(projectId);
  const bible = await store.listBible(projectId);
  const after: SyncAfter = { chapters: {}, bible: {} };
  for (const chapter of chapters) {
    after.chapters![chapter.id] = chapter.revision;
  }
  for (const file of bible) {
    after.bible![file.path] = file.revision;
  }
  if (!opts?.withHashes) return after;

  const pending = await store.listPendingOps(projectId);
  const unpushed = new Set(pending.map((row) => row.chapterId));
  after.hashes = {};
  for (const chapter of chapters) {
    // A chapter carrying unpushed ops sits at a revision the server has never
    // heard of, so its bytes cannot be meaningfully compared. Everything else
    // is claimed as confirmed, and the server will say so if it disagrees.
    if (!unpushed.has(chapter.id)) {
      after.hashes[chapter.id] = docHash(chapter.content);
    }
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
  ops: ChapterOpRecord[],
  skipBlockIds?: Iterable<string>
): Promise<number> {
  const byChapter = new Map<string, ChapterOpRecord[]>();
  for (const op of ops) {
    const list = byChapter.get(op.chapterId) ?? [];
    list.push(op);
    byChapter.set(op.chapterId, list);
    await store.insertOp(replicaOpFromRemote(op));
  }

  const skip = { skipBlockIds };
  let applied = 0;
  for (const [chapterId, chapterOps] of byChapter) {
    let snapshot = await store.getChapter(chapterId);
    if (!snapshot) {
      snapshot = await refetchChapter(store, api, projectId, chapterId);
    }
    if (!snapshot) continue;

    const result = applyRemoteOps(snapshot, chapterOps, skip);
    if (result.ok) {
      await store.upsertChapter(preserveFocusedBlocks(snapshot, result.chapter, skipBlockIds));
      applied += result.applied;
      continue;
    }
    const fresh = await refetchChapter(store, api, projectId, chapterId);
    if (fresh) {
      const retry = applyRemoteOps(fresh, chapterOps, skip);
      if (retry.ok) {
        await store.upsertChapter(preserveFocusedBlocks(snapshot, retry.chapter, skipBlockIds));
        applied += retry.applied;
      } else {
        await store.upsertChapter(preserveFocusedBlocks(snapshot, fresh, skipBlockIds));
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

/**
 * The safety net under the op feed. No code path in the app moves
 * `Chapter.revision` without a `ChapterOp` any more — autowrite and the passage
 * tools commit through the log now — but a chapter can still be left behind by
 * rows an older build wrote, or by an op this replica could not apply. Any
 * chapter whose head is ahead of the replica after the ops were applied is
 * refetched whole, so the phone can never wedge behind the server and push from
 * a base that no longer exists.
 */
async function reconcileHeads(
  store: ReplicaStore,
  api: SyncApi,
  projectId: string,
  heads: SyncResult["chapters"],
  skipBlockIds?: Iterable<string>
): Promise<number> {
  const behind: string[] = [];
  for (const head of heads) {
    const local = await store.getChapter(head.id);
    if (!local || local.revision < head.revision) behind.push(head.id);
  }
  if (behind.length === 0) return 0;
  const listed = await api.listChapters(projectId);
  let refetched = 0;
  for (const chapterId of behind) {
    const found = listed.find((c) => c.id === chapterId);
    if (!found) continue;
    const local = await store.getChapter(chapterId);
    const fresh = toChapterSnapshot(found);
    await store.upsertChapter(local ? preserveFocusedBlocks(local, fresh, skipBlockIds) : fresh);
    refetched += 1;
  }
  return refetched;
}

/**
 * Adopt the server's bytes for a chapter both sides claim to be at the same
 * revision of. Convergence used to be assumed; this is what happens when the
 * hash check proves it wrong. The server's copy wins because it is the one the
 * log agrees with — but a block the author has focused is kept, so healing a
 * divergence cannot swallow the sentence being typed.
 */
async function healDiverged(
  store: ReplicaStore,
  projectId: string,
  diverged: SyncResult["diverged"],
  skipBlockIds?: Iterable<string>
): Promise<number> {
  let healed = 0;
  for (const item of diverged ?? []) {
    const fresh = toChapterSnapshot({
      ...item.chapter,
      projectId: item.chapter.projectId || projectId,
    });
    const local = await store.getChapter(item.chapterId);
    await store.upsertChapter(local ? preserveFocusedBlocks(local, fresh, skipBlockIds) : fresh);
    healed += 1;
  }
  return healed;
}

async function applySyncResult(
  store: ReplicaStore,
  api: SyncApi,
  scope: SyncScope,
  result: SyncResult,
  skipBlockIds?: Iterable<string>
): Promise<{ pulledOps: number; healed: number; position: ReplicaReadingPosition | null }> {
  // Heal first: the ops in this response are for seqs after the revision the
  // hashes were compared at, so they have to land on the corrected document.
  const healed = await healDiverged(store, scope.projectId, result.diverged, skipBlockIds);
  const pulledOps = await applyPulledOps(store, api, scope.projectId, result.ops, skipBlockIds);
  await reconcileHeads(store, api, scope.projectId, result.chapters, skipBlockIds);
  await applyBiblePull(store, scope.projectId, result.bibleFiles);
  const position = await applyPositionPull(store, scope, result.position);
  return { pulledOps, healed, position };
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
  const snapshot = await store.getChapter(op.chapterId);
  if (snapshot) {
    const applied = applyPendingOps(snapshot, [op]);
    if (applied.content !== snapshot.content || applied.revision !== snapshot.revision) {
      await store.upsertChapter(applied);
    }
  }
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

type RejectedGroup = {
  chapter: SyncResult["rejected"][number]["chapter"];
  reason: "stale" | "missing_block";
  ops: ManuscriptOp[];
};

/**
 * Put a rejection back together into the authoring actions it came from. The
 * server rejects a group as a whole, so its ops arrive as separate entries
 * that have to be rebased as one; an ungrouped op is keyed by its own opId and
 * stays on its own.
 */
function rejectedGroups(rejected: SyncResult["rejected"]): RejectedGroup[] {
  const groups = new Map<string, RejectedGroup>();
  const order: RejectedGroup[] = [];
  for (const item of rejected) {
    const key = `${item.chapter.id}:${item.op.groupId ?? item.op.opId}`;
    const open = groups.get(key);
    if (open) {
      open.ops.push(item.op);
      continue;
    }
    const group: RejectedGroup = {
      chapter: item.chapter,
      reason: item.reason,
      ops: [item.op],
    };
    groups.set(key, group);
    order.push(group);
  }
  return order;
}

async function handleRejected(
  store: ReplicaStore,
  scope: SyncScope,
  result: SyncResult,
  body: SyncPushRequest
): Promise<{ rebased: number; dropped: number }> {
  let rebased = 0;
  let dropped = 0;
  for (const group of rejectedGroups(result.rejected)) {
    const snapshot = snapshotFromRejected(group.chapter, scope.projectId);
    await store.upsertChapter(snapshot);
    const { retry } = rebaseRejectedGroup({
      ops: group.ops,
      reason: group.reason,
      chapter: snapshot,
    });
    await store.deletePendingOps(group.ops.map((op) => op.opId));
    dropped += group.ops.length - retry.length;
    for (const op of retry) {
      await store.enqueueOp({
        opId: op.opId,
        chapterId: snapshot.id,
        projectId: scope.projectId,
        payload: payloadOf(op),
        createdAt: nowIso(),
      });
      rebased += 1;
    }
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

type CycleCounts = {
  pulledOps: number;
  pushedOps: number;
  rebased: number;
  dropped: number;
  healed: number;
};

async function finishCycle(
  store: ReplicaStore,
  scope: SyncScope,
  counts: CycleCounts,
  position: ReplicaReadingPosition | null
): Promise<SyncCycleResult> {
  const chapters = await store.listChapters(scope.projectId);
  return {
    position: position ?? (await store.getPosition(scope.userId, scope.projectId)),
    chapters,
    ...counts,
  };
}

export async function pullProject(
  store: ReplicaStore,
  scope: SyncScope,
  api: SyncApi = defaultSyncApi,
  opts?: SyncSkipOptions
): Promise<SyncCycleResult> {
  const localChapters = await store.listChapters(scope.projectId);
  if (localChapters.length === 0) {
    const listed = await api.listChapters(scope.projectId);
    for (const chapter of listed) {
      await store.upsertChapter(toChapterSnapshot(chapter));
    }
  }
  const after = await localAfter(store, scope.projectId, { withHashes: true });
  const result = await api.pull(scope.projectId, after);
  const applied = await applySyncResult(store, api, scope, result, opts?.skipBlockIds);
  return finishCycle(
    store,
    scope,
    {
      pulledOps: applied.pulledOps,
      pushedOps: 0,
      rebased: 0,
      dropped: 0,
      healed: applied.healed,
    },
    applied.position
  );
}

async function pushOnce(
  store: ReplicaStore,
  scope: SyncScope,
  api: SyncApi,
  skipBlockIds?: Iterable<string>
): Promise<{
  result: SyncResult;
  body: SyncPushRequest;
  rebased: number;
  dropped: number;
  healed: number;
}> {
  const body = await collectPushBody(store, scope);
  const result = await api.push(body);
  const handled = await handleRejected(store, scope, result, body);
  const applied = await applySyncResult(store, api, scope, result, skipBlockIds);
  return { result, body, ...handled, healed: applied.healed };
}

export async function pushProject(
  store: ReplicaStore,
  scope: SyncScope,
  api: SyncApi = defaultSyncApi,
  opts?: SyncSkipOptions
): Promise<SyncCycleResult> {
  const first = await pushOnce(store, scope, api, opts?.skipBlockIds);
  let rebased = first.rebased;
  let dropped = first.dropped;
  let healed = first.healed;
  let last = first;
  if (first.rebased > 0) {
    last = await pushOnce(store, scope, api, opts?.skipBlockIds);
    rebased += last.rebased;
    dropped += last.dropped;
    healed += last.healed;
  }
  const position = await store.getPosition(scope.userId, scope.projectId);
  return finishCycle(
    store,
    scope,
    {
      pulledOps: last.result.ops.length,
      pushedOps: first.body.ops?.length ?? 0,
      rebased,
      dropped,
      healed,
    },
    position
  );
}

export async function syncProject(
  store: ReplicaStore,
  scope: SyncScope,
  api: SyncApi = defaultSyncApi,
  opts?: SyncSkipOptions
): Promise<SyncCycleResult> {
  const existing = inflight.get(scope.projectId);
  if (existing) return existing;
  const run = (async () => {
    if (await hasPending(store, scope)) {
      return pushProject(store, scope, api, opts);
    }
    return pullProject(store, scope, api, opts);
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
