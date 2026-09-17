/**
 * The keystroke buffer for every paragraph the author has touched, keyed by
 * chapter and block. It lives at module scope on purpose: a remount of a
 * `BlockInput`, of the manuscript screen, or of the whole project stack must
 * read the author's unflushed typing back, never the last committed HTML.
 * Entries are removed when a block flushes on blur or is deleted.
 */
const drafts = new Map<string, Map<string, string>>();

export function chapterDrafts(chapterId: string): Map<string, string> {
  let map = drafts.get(chapterId);
  if (!map) {
    map = new Map();
    drafts.set(chapterId, map);
  }
  return map;
}

export function clearChapterDrafts(chapterId: string): void {
  drafts.delete(chapterId);
}

/** Test hook. */
export function resetAllDrafts(): void {
  drafts.clear();
}
