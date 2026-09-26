import type { ManuscriptKind } from "./manuscript-kind";

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

type Translate = (key: string, opts?: { number: number }) => string;

/**
 * Heading and optional second line for a chapter row. A novel leads with its
 * number; a screenplay numbers sequences; a journal leads with the entry's
 * date; a blog post is just its title.
 */
export function chapterHeading(
  kind: ManuscriptKind,
  number: number,
  title: string | undefined,
  t: Translate
): { heading: string; custom: string | null; label: string } {
  const trimmed = title?.trim() ?? "";
  if (kind === "journal") {
    const heading = trimmed || t("kinds.entryNumber", { number });
    return { heading, custom: null, label: heading };
  }
  if (kind === "blog") {
    const heading = trimmed || t("kinds.post");
    return { heading, custom: null, label: heading };
  }
  const numbered =
    kind === "screenplay"
      ? t("kinds.sequenceNumber", { number })
      : chapterNumberLabel(number, (key, opts) => t(key, opts));
  const custom = customChapterTitle(title, numbered, t("chapters.newTitle"));
  return { heading: numbered, custom, label: custom ? `${numbered}, ${custom}` : numbered };
}
