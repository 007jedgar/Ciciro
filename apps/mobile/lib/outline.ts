import type { Chapter } from "./types";

/** Height of one outline row; the drag maths steps in whole rows. */
export const OUTLINE_ROW_HEIGHT = 96;

/** Move one entry to a new index, returning a new array. Out-of-range targets clamp. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Where a row dragged `translationY` points from `from` lands, in whole rows. */
export function dropIndexFor(
  from: number,
  translationY: number,
  count: number,
  rowHeight: number = OUTLINE_ROW_HEIGHT
): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, from + Math.round(translationY / rowHeight)));
}

/** Lay chapters out in the given id order, renumbering `order`; unlisted ones follow. */
export function applyChapterOrder<T extends Pick<Chapter, "id" | "order">>(
  chapters: T[],
  ids: readonly string[]
): T[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const id of ids) {
    const chapter = byId.get(id);
    if (chapter && !seen.has(id)) {
      seen.add(id);
      ordered.push(chapter);
    }
  }
  for (const chapter of chapters) if (!seen.has(chapter.id)) ordered.push(chapter);
  return ordered.map((c, i) => (c.order === i ? c : { ...c, order: i }));
}

export function outlineHref(projectId: string): string {
  return `/project/${projectId}/outline`;
}
