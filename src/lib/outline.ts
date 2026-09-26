import type { Chapter } from "@/lib/types";

/** Move one entry to a new index, returning a new array. Out-of-range targets clamp. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const target = Math.max(0, Math.min(items.length - 1, to));
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Lay chapters out in the given id order and renumber `order` to match. */
export function applyChapterOrder(chapters: Chapter[], ids: readonly string[]): Chapter[] {
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const ordered: Chapter[] = [];
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

const SUMMARY_FALLBACK_CHARS = 180;

/** The card blurb: the assistant's beat summary, else the chapter's opening words. */
export function chapterBlurb(summary: string, plainText: string): string {
  const s = summary.trim();
  if (s) return s;
  const text = plainText.replace(/\s+/g, " ").trim();
  return text.length > SUMMARY_FALLBACK_CHARS
    ? `${text.slice(0, SUMMARY_FALLBACK_CHARS).trimEnd()}...`
    : text;
}
