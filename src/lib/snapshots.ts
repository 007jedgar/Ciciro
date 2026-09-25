import type { ChapterSnapshot } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedChapter } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { ensureBlockIds } from "@/lib/block-ids";
import { countWords, htmlToText } from "@/lib/text";
import {
  cleanSnapshotLabel,
  isSnapshotKind,
  type ChapterSnapshotDetail,
  type ChapterSnapshotSummary,
  type SnapshotKind,
} from "@/lib/snapshot-view";

// Chapter version history: the store, its retention, and the automatic
// capture points. Restoring lives in snapshot-restore.ts, because it writes
// through the op log and chapter-ops calls into this module.

/** Automatic snapshots kept per chapter; the oldest go first. */
export const AUTO_SNAPSHOT_LIMIT = 50;
/** Manual snapshots kept per chapter. Generous, since the author chose each. */
export const MANUAL_SNAPSHOT_LIMIT = 100;
/** Quiet time on a chapter after which the next keystroke starts a new session. */
export const SESSION_GAP_MS = 30 * 60 * 1000;
/**
 * A pre-edit snapshot younger than this, followed only by the editor's own
 * ops, is the same run still working: one snapshot covers all of its edits.
 */
export const AI_RUN_WINDOW_MS = 60 * 60 * 1000;

type ChapterText = { id: string; projectId: string; content: string; revision: number };

export const SUMMARY_COLUMNS = {
  id: true,
  chapterId: true,
  kind: true,
  label: true,
  wordCount: true,
  revision: true,
  createdAt: true,
} as const;

type SnapshotSummaryRow = Pick<
  ChapterSnapshot,
  "id" | "chapterId" | "kind" | "label" | "wordCount" | "revision" | "createdAt"
>;

export function toSnapshotSummary(row: SnapshotSummaryRow): ChapterSnapshotSummary {
  return {
    id: row.id,
    chapterId: row.chapterId,
    kind: isSnapshotKind(row.kind) ? row.kind : "manual",
    label: row.label,
    wordCount: row.wordCount,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSnapshotDetail(row: ChapterSnapshot): ChapterSnapshotDetail {
  return { ...toSnapshotSummary(row), content: row.content };
}

/**
 * Drop the oldest snapshots past each limit. Manual and automatic snapshots
 * are counted separately, so a busy week of editor runs cannot push out a
 * version the author saved by hand.
 */
export async function pruneSnapshots(
  chapterId: string,
  opts?: { keep?: string }
): Promise<number> {
  const rows = await prisma.chapterSnapshot.findMany({
    where: { chapterId, ...(opts?.keep ? { id: { not: opts.keep } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, kind: true },
  });
  const manual = rows.filter((row) => row.kind === "manual");
  const automatic = rows.filter((row) => row.kind !== "manual");
  const doomed = [
    ...manual.slice(MANUAL_SNAPSHOT_LIMIT),
    ...automatic.slice(AUTO_SNAPSHOT_LIMIT),
  ].map((row) => row.id);
  if (doomed.length === 0) return 0;
  const result = await prisma.chapterSnapshot.deleteMany({ where: { id: { in: doomed } } });
  return result.count;
}

/**
 * Save `chapter`'s current text as a snapshot.
 *
 * Automatic kinds skip an empty chapter and skip text identical to the newest
 * snapshot, so history lists versions rather than repeats. A manual snapshot
 * is always taken: the author asked for it, and may be naming the version.
 */
export async function captureSnapshot(
  chapter: ChapterText,
  kind: SnapshotKind,
  opts?: { label?: string; at?: Date; keep?: string }
): Promise<ChapterSnapshot | null> {
  const wordCount = countWords(htmlToText(chapter.content));
  if (kind !== "manual") {
    if (wordCount === 0) return null;
    const latest = await prisma.chapterSnapshot.findFirst({
      where: { chapterId: chapter.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { content: true },
    });
    if (latest?.content === chapter.content) return null;
  }
  const row = await prisma.chapterSnapshot.create({
    data: {
      chapterId: chapter.id,
      projectId: chapter.projectId,
      kind,
      label: kind === "manual" ? cleanSnapshotLabel(opts?.label) : "",
      content: chapter.content,
      wordCount,
      revision: chapter.revision,
      ...(opts?.at ? { createdAt: opts.at } : {}),
    },
  });
  await pruneSnapshots(chapter.id, { keep: opts?.keep });
  return row;
}

/**
 * Automatic snapshots are a safety net, never a gate: a missing table on a
 * database that has not had the migration applied, or any other failure,
 * must not cost the author the write it was guarding.
 */
async function bestEffort(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.warn(`[snapshots] ${label} skipped:`, (error as Error)?.message ?? error);
  }
}

async function lastOp(chapterId: string) {
  return prisma.chapterOp.findFirst({
    where: { chapterId },
    orderBy: { seq: "desc" },
    select: { actor: true, createdAt: true },
  });
}

/**
 * Called before the editor (or autowrite) commits prose to a chapter. Keeps
 * the text as the author left it, once per run: while the newest snapshot is
 * a recent pre-edit one and nobody but the editor has written since, the run
 * is still going and the snapshot already taken covers it.
 */
export async function snapshotBeforeAiWrite(chapter: ChapterText, now = new Date()): Promise<void> {
  await bestEffort("before_ai", async () => {
    const [op, latest] = await Promise.all([
      lastOp(chapter.id),
      prisma.chapterSnapshot.findFirst({
        where: { chapterId: chapter.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { kind: true, createdAt: true },
      }),
    ]);
    const sameRun =
      op?.actor === "ai" &&
      latest?.kind === "before_ai" &&
      now.getTime() - latest.createdAt.getTime() < AI_RUN_WINDOW_MS;
    if (sameRun) return;
    await captureSnapshot(chapter, "before_ai");
  });
}

/**
 * Called before author ops land. When the chapter has been quiet for a
 * session gap, the text on it now is how the last session ended; keep it,
 * dated to that session's last edit. Every client's writes arrive through
 * appendOps, so desk and phone sessions are both covered without either one
 * having to notice it is being closed.
 */
export async function snapshotSessionBoundary(chapterId: string, now = new Date()): Promise<void> {
  await bestEffort("session", async () => {
    const op = await lastOp(chapterId);
    if (!op) return;
    if (now.getTime() - op.createdAt.getTime() < SESSION_GAP_MS) return;
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true, projectId: true, content: true, revision: true },
    });
    if (!chapter) return;
    await captureSnapshot(chapter, "session", { at: op.createdAt });
  });
}

/** Newest first, without the prose. */
export async function listSnapshots(
  chapterId: string,
  user: PublicUser | null
): Promise<ChapterSnapshotSummary[]> {
  await authorizeOwnedChapter(chapterId, user);
  const rows = await prisma.chapterSnapshot.findMany({
    where: { chapterId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SUMMARY_COLUMNS,
  });
  return rows.map(toSnapshotSummary);
}

export async function getSnapshot(
  chapterId: string,
  snapshotId: string,
  user: PublicUser | null
): Promise<ChapterSnapshotDetail> {
  await authorizeOwnedChapter(chapterId, user);
  const row = await prisma.chapterSnapshot.findFirst({ where: { id: snapshotId, chapterId } });
  if (!row) throw new AuthError("Not found.", 404);
  return toSnapshotDetail(row);
}

/** The author's "Save snapshot": whatever the chapter says right now. */
export async function saveManualSnapshot(
  chapterId: string,
  user: PublicUser | null,
  input: { label?: unknown }
): Promise<ChapterSnapshotSummary> {
  await authorizeOwnedChapter(chapterId, user);
  const found = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!found) throw new AuthError("Not found.", 404);
  const chapter = await ensureBlockIds(found);
  const row = await captureSnapshot(chapter, "manual", { label: cleanSnapshotLabel(input.label) });
  if (!row) throw new AuthError("Could not save the snapshot.", 500);
  return toSnapshotSummary(row);
}

export async function deleteSnapshot(
  chapterId: string,
  snapshotId: string,
  user: PublicUser | null
): Promise<{ ok: true }> {
  await authorizeOwnedChapter(chapterId, user);
  const result = await prisma.chapterSnapshot.deleteMany({ where: { id: snapshotId, chapterId } });
  if (result.count === 0) throw new AuthError("Not found.", 404);
  return { ok: true };
}
