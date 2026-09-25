import type { Chapter } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedChapter } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { ensureBlockIds } from "@/lib/block-ids";
import { writeChapterHtml } from "@/lib/chapter-writes";
import { captureSnapshot, toSnapshotSummary } from "@/lib/snapshots";
import type { ChapterSnapshotSummary } from "@/lib/snapshot-view";

export type RestoreResult = {
  chapter: Chapter;
  /** The snapshot that was restored. */
  restored: ChapterSnapshotSummary;
  /** The text the restore replaced, kept so the restore can itself be undone. */
  backup: ChapterSnapshotSummary | null;
};

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

  let backup: ChapterSnapshotSummary | null = null;
  for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt++) {
    const found = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!found) throw new AuthError("Not found.", 404);
    const current = await ensureBlockIds(found);
    // Unlike the automatic snapshots this one is not best effort: a restore
    // that cannot keep the text it replaces does not run.
    const saved = await captureSnapshot(current, "before_restore");
    if (saved) backup = toSnapshotSummary(saved);
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
