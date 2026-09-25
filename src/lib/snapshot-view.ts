import { diffWords } from "diff";
import { htmlToText } from "@/lib/text";

// Chapter version history, the parts both the server and the browser need.
// No database access here, so the history panel can import it.

export const SNAPSHOT_KINDS = ["manual", "before_ai", "session", "before_restore"] as const;

export type SnapshotKind = (typeof SNAPSHOT_KINDS)[number];

/** One row in the history list. The prose itself is fetched on demand. */
export type ChapterSnapshotSummary = {
  id: string;
  chapterId: string;
  kind: SnapshotKind;
  label: string;
  wordCount: number;
  revision: number;
  createdAt: string;
};

export type ChapterSnapshotDetail = ChapterSnapshotSummary & { content: string };

/** Longest name an author can give a manual snapshot. */
export const SNAPSHOT_LABEL_MAX = 120;

export function isSnapshotKind(value: unknown): value is SnapshotKind {
  return typeof value === "string" && (SNAPSHOT_KINDS as readonly string[]).includes(value);
}

/** What the history list calls a snapshot when the author did not name it. */
export function snapshotKindLabel(kind: SnapshotKind): string {
  switch (kind) {
    case "manual":
      return "Saved snapshot";
    case "before_ai":
      return "Before Ciciro's edits";
    case "session":
      return "End of a writing session";
    case "before_restore":
      return "Before a restore";
  }
}

export function snapshotTitle(snapshot: Pick<ChapterSnapshotSummary, "kind" | "label">): string {
  return snapshot.label.trim() || snapshotKindLabel(snapshot.kind);
}

/** Trim and bound an author-supplied snapshot name. Non-strings become "". */
export function cleanSnapshotLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, SNAPSHOT_LABEL_MAX);
}

export type SnapshotDiffPart = { kind: "same" | "added" | "removed"; text: string };

/**
 * Word diff from one chapter text to another, on plain text with paragraph
 * breaks kept. `from` is the older side: "removed" is prose only it has.
 */
export function snapshotDiff(fromHtml: string, toHtml: string): SnapshotDiffPart[] {
  const parts = diffWords(htmlToText(fromHtml), htmlToText(toHtml));
  return parts.map((part) => ({
    kind: part.added ? "added" : part.removed ? "removed" : "same",
    text: part.value,
  }));
}

/** Words added and removed, for a one-line summary above the diff. */
export function diffStats(parts: SnapshotDiffPart[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.kind === "same") continue;
    const words = part.text.trim() ? part.text.trim().split(/\s+/).length : 0;
    if (part.kind === "added") added += words;
    else removed += words;
  }
  return { added, removed };
}
