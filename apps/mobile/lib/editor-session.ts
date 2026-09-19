import type { ManuscriptBlock } from "./manuscript";

export type ChapterContentSlice = {
  content: string;
  revision: number;
  wordCount: number;
  title: string;
  summary: string;
  status: string;
};

export type ReadingPlace = {
  chapterId: string;
  blockId: string;
  offset: number;
};

export function reuseUnchangedBlocks(
  previous: readonly ManuscriptBlock[] | undefined,
  next: ManuscriptBlock[]
): ManuscriptBlock[] {
  if (!previous || previous.length === 0) return next;
  if (previous.length !== next.length) {
    return next.map((block, index) => reuseBlock(previous[index], block));
  }
  let changed = false;
  const reused = next.map((block, index) => {
    const kept = reuseBlock(previous[index], block);
    if (kept !== previous[index]) changed = true;
    return kept;
  });
  return changed ? reused : (previous as ManuscriptBlock[]);
}

function reuseBlock(previous: ManuscriptBlock | undefined, next: ManuscriptBlock): ManuscriptBlock {
  if (
    previous &&
    previous.id === next.id &&
    previous.html === next.html &&
    previous.text === next.text &&
    previous.kind === next.kind &&
    previous.level === next.level
  ) {
    return previous;
  }
  return next;
}

export function chapterSliceUnchanged<T extends ChapterContentSlice>(
  current: T,
  next: ChapterContentSlice
): boolean {
  return (
    current.content === next.content &&
    current.revision === next.revision &&
    current.wordCount === next.wordCount &&
    current.title === next.title &&
    current.summary === next.summary &&
    current.status === next.status
  );
}

export function assignChapterSlice<T extends ChapterContentSlice>(
  current: T,
  next: Partial<ChapterContentSlice>
): T {
  const merged: ChapterContentSlice = {
    content: next.content ?? current.content,
    revision: next.revision ?? current.revision,
    wordCount: next.wordCount ?? current.wordCount,
    title: next.title ?? current.title,
    summary: next.summary ?? current.summary,
    status: next.status ?? current.status,
  };
  if (chapterSliceUnchanged(current, merged)) return current;
  return { ...current, ...merged };
}

export function assignChaptersFromSnapshots<T extends ChapterContentSlice & { id: string }>(
  chapters: T[],
  snapshots: Array<Partial<ChapterContentSlice> & { id: string }>
): T[] {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  let changed = false;
  const next = chapters.map((chapter) => {
    const snapshot = byId.get(chapter.id);
    if (!snapshot) return chapter;
    const assigned = assignChapterSlice(chapter, snapshot);
    if (assigned !== chapter) changed = true;
    return assigned;
  });
  return changed ? next : chapters;
}

/**
 * A server fetch of the project must not paint over prose the replica already
 * holds at the same or a newer revision (local ops applied, echo not yet
 * pulled). Server chapters that are genuinely ahead win; sync will bring the
 * replica up to them.
 */
export function overlayReplicaChapters<T extends ChapterContentSlice & { id: string }>(
  chapters: T[],
  snapshots: Array<Pick<ChapterContentSlice, "content" | "revision" | "wordCount"> & { id: string }>
): T[] {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  return chapters.map((chapter) => {
    const snapshot = byId.get(chapter.id);
    if (!snapshot || snapshot.revision < chapter.revision) return chapter;
    return assignChapterSlice(chapter, {
      content: snapshot.content,
      revision: snapshot.revision,
      wordCount: snapshot.wordCount,
    });
  });
}

export function sameReadingPosition(
  a: Pick<ReadingPlace, "chapterId" | "blockId" | "offset"> | null | undefined,
  b: Pick<ReadingPlace, "chapterId" | "blockId" | "offset"> | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.chapterId === b.chapterId && a.blockId === b.blockId && a.offset === b.offset;
}

/** Keep a chapter's first resume caret; ignore later offset-only echoes. */
export function freezeResumePlace(
  frozen: ReadingPlace | null,
  incoming: ReadingPlace | null
): ReadingPlace | null {
  if (!incoming) return frozen;
  if (frozen && frozen.chapterId === incoming.chapterId) return frozen;
  return incoming;
}

export function sameLocalDoc(
  current: { chapterId: string; content: string; revision: number } | null,
  next: { chapterId: string; content: string; revision: number }
): boolean {
  return (
    current?.chapterId === next.chapterId &&
    current.content === next.content &&
    current.revision === next.revision
  );
}
