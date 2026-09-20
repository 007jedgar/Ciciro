/** Numbered label for a chapter list row, e.g. "Chapter 3". */
export function chapterNumberLabel(
  number: number,
  t: (key: string, opts: { number: number }) => string
): string {
  return t("chapters.number", { number });
}

/**
 * A custom name to show under the number. Default "Chapter N" / "New chapter"
 * titles are omitted so the number is the only heading on the row.
 */
export function customChapterTitle(
  title: string | undefined,
  numberedLabel: string,
  newTitle: string
): string | null {
  const trimmed = title?.trim() ?? "";
  if (!trimmed || trimmed === numberedLabel || trimmed === newTitle) return null;
  return trimmed;
}

/** How many wrapped lines of summary/prose the chapter list is allowed to show. */
export const CHAPTER_PREVIEW_LINES = 10;
