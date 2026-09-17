import type { Chapter } from "./api/types";
import type { ReplicaStore } from "./replica-store";

/** Copy title/summary/status from a PATCH onto the replica without clobbering local prose. */
export async function stampChapterMetadata(
  store: ReplicaStore,
  chapter: Pick<Chapter, "id" | "title" | "summary" | "status" | "revision">
): Promise<void> {
  const row = await store.getChapter(chapter.id);
  if (!row) return;
  await store.upsertChapter({
    ...row,
    title: chapter.title,
    summary: chapter.summary,
    status: chapter.status,
    revision: Math.max(row.revision, chapter.revision),
  });
}
