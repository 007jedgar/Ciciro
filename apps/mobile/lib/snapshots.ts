import { diffWords } from "diff";
import { htmlToPlainText } from "./html";
import type { ChapterSnapshotKind, ChapterSnapshotSummary } from "./api/types";

// Chapter version history on the phone: the pure parts the history screen
// renders from. Mirrors src/lib/snapshot-view.ts on the web.

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export const SNAPSHOT_LABEL_MAX = 120;

export type SnapshotDiffPart = { kind: "same" | "added" | "removed"; text: string };

export function snapshotKindKey(kind: ChapterSnapshotKind): string {
  return `history.kind.${kind}`;
}

/** The author's name for the version, or how it was taken. */
export function snapshotTitle(
  snapshot: Pick<ChapterSnapshotSummary, "kind" | "label">,
  t: Translate
): string {
  return snapshot.label.trim() || t(snapshotKindKey(snapshot.kind));
}

/**
 * Word diff from one chapter text to another. `from` is the older side:
 * "removed" is prose only it has. The history screen passes the current text
 * first, so the parts read as what restoring the version would do.
 */
export function snapshotDiff(fromHtml: string, toHtml: string): SnapshotDiffPart[] {
  return diffWords(htmlToPlainText(fromHtml), htmlToPlainText(toHtml)).map((part) => ({
    kind: part.added ? "added" : part.removed ? "removed" : "same",
    text: part.value,
  }));
}

function wordsIn(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function diffStats(parts: SnapshotDiffPart[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.kind === "added") added += wordsIn(part.text);
    else if (part.kind === "removed") removed += wordsIn(part.text);
  }
  return { added, removed };
}

/** One line above the diff: what a restore would bring back and take away. */
export function restoreSummary(stats: { added: number; removed: number }, t: Translate): string {
  if (stats.added > 0 && stats.removed > 0) {
    return t("history.addsAndRemoves", {
      added: t("chapters.wordCount", { count: stats.added }),
      removed: t("chapters.wordCount", { count: stats.removed }),
    });
  }
  if (stats.added > 0) return t("history.addsOnly", { count: stats.added });
  if (stats.removed > 0) return t("history.removesOnly", { count: stats.removed });
  return t("history.same");
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today, 3:42 PM", "Yesterday, 9:05 AM", or a short date, in the app's language. */
export function formatSnapshotTime(
  iso: string,
  locale: string,
  t: Translate,
  now = new Date()
): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (sameDay(at, now)) return t("history.today", { time });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, yesterday)) return t("history.yesterday", { time });
  const date = at.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}
