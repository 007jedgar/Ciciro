import { newBlockId, type ManuscriptBlock } from "./manuscript";

/** Invisible prefix so iOS has a character to delete at visual offset 0. */
export const CARET_GUARD = "\u200B";

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

export type TextInputDelta = {
  text?: string;
  previousText?: string;
  range?: { start: number; end: number };
  key?: string;
  isComposing?: boolean;
};

export function withCaretGuard(text: string): string {
  return text.startsWith(CARET_GUARD) ? text : `${CARET_GUARD}${text}`;
}

export function stripCaretGuard(text: string): string {
  return text.split(CARET_GUARD).join("");
}

export function toNativeOffset(logical: number): number {
  return Math.max(0, logical) + CARET_GUARD.length;
}

export function toLogicalOffset(native: number): number {
  return Math.max(0, native - CARET_GUARD.length);
}

/**
 * iOS deletes only the leading guard when Backspace is pressed at the visual
 * start of a paragraph. Selecting all and typing is not this case.
 */
export function isGuardDeleted(next: string, displayed: string): boolean {
  if (!displayed.startsWith(CARET_GUARD) || next.startsWith(CARET_GUARD)) return false;
  return next === displayed.slice(CARET_GUARD.length);
}

export function isBackspaceAtStart(
  event: TextInputDelta,
  selectionStart: number,
  selectionEnd: number = selectionStart
): boolean {
  if (event.isComposing) return false;
  if (event.key === "Backspace" && selectionStart === 0 && selectionEnd === 0) return true;
  const range = event.range;
  if (!range || selectionStart !== 0 || selectionEnd !== 0) return false;
  if (range.start !== 0 || range.end !== 0) return false;
  return (event.text ?? "") === "";
}

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

/**
 * The empty-chapter TextInput keeps one placeholder id so the first keystroke
 * does not remount. Return and later inserts must mint a new id — reusing
 * `draft-block` is what produced duplicate React keys.
 */
export function takePlaceholderBlockId(emptyId: { current: string | null }): string {
  const id = emptyId.current;
  emptyId.current = null;
  return id ?? newBlockId();
}
