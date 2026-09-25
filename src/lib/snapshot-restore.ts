import type { Chapter } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedChapter } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { ensureBlockIds } from "@/lib/block-ids";
import { writeChapterHtml } from "@/lib/chapter-writes";
import { captureSnapshot, SUMMARY_COLUMNS, toSnapshotSummary } from "@/lib/snapshots";
import type { ChapterSnapshotSummary } from "@/lib/snapshot-view";

export type RestoreResult = {
  chapter: Chapter;
  /** The snapshot that was restored. */
  restored: ChapterSnapshotSummary;
  /** The text the restore replaced, kept so the restore can itself be undone. */
  backup: ChapterSnapshotSummary | null;
};

/**
 * Snapshot the text a restore is about to replace, or find the snapshot that
 * already holds it: capture skips a copy of the newest snapshot, and the
 * author still needs something to undo to.
 */
async function keepCurrentText(
  current: Chapter,
  restoringId: string
): Promise<ChapterSnapshotSummary | null> {
  const saved = await captureSnapshot(current, "before_restore", { keep: restoringId });
  if (saved) return toSnapshotSummary(saved);
  const existing = await prisma.chapterSnapshot.findFirst({
    where: { chapterId: current.id, content: current.content },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SUMMARY_COLUMNS,
  });
  return existing ? toSnapshotSummary(existing) : null;
}

/** Head moves between reading the chapter and committing are retried this often. */
const RESTORE_ATTEMPTS = 3;

/**
 * Put a snapshot's text back on its chapter.
 *
 * The restore is an ordinary write: `writeChapterHtml` turns it into block ops
 * and commits them through the log, which moves the head, pokes every replica,
 * and lets a phone replay the change instead of refetching the chapter. The
 * current text is snapshotted first, so undoing a restore is restoring that.
 */
export async function restoreSnapshot(
  chapterId: string,
  snapshotId: string,
  user: PublicUser | null
): Promise<RestoreResult> {
  await authorizeOwnedChapter(chapterId, user);
  const snapshot = await prisma.chapterSnapshot.findFirst({
    where: { id: snapshotId, chapterId },
  });
  if (!snapshot) throw new AuthError("Not found.", 404);

  for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt++) {
    const found = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!found) throw new AuthError("Not found.", 404);
    const current = await ensureBlockIds(found);
    if (current.content === snapshot.content) {
      return { chapter: current, restored: toSnapshotSummary(snapshot), backup: null };
    }
    // Unlike the automatic snapshots this one is not best effort: a restore
    // that cannot keep the text it replaces does not run.
    const backup = await keepCurrentText(current, snapshot.id);
    const written = await writeChapterHtml(current, snapshot.content, { actor: "user" });
    if (written.ok) {
      const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
      if (!chapter) throw new AuthError("Not found.", 404);
      return { chapter, restored: toSnapshotSummary(snapshot), backup };
    }
  }
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  throw new AuthError("Chapter revision conflict", 409, {
    error: "The chapter kept changing while restoring. Try again.",
    currentRevision: chapter?.revision ?? null,
    chapter,
  });
}
