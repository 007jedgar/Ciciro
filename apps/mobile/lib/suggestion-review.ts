import { htmlToDoc } from "./manuscript";
import { hasSuggestions, type SuggestionSummary } from "./suggestions";

// Small pure helpers behind the phone's suggestion review sheet.

export type SuggestionAge =
  | { key: "justNow" }
  | { key: "minutesAgo" | "hoursAgo" | "daysAgo"; count: number }
  | null;

/** How long ago a suggestion was made, as an i18n key and count. */
export function suggestionAge(createdAt: string, now = Date.now()): SuggestionAge {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return { key: "justNow" };
  if (minutes < 60) return { key: "minutesAgo", count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { key: "hoursAgo", count: hours };
  return { key: "daysAgo", count: Math.round(hours / 24) };
}

/** "Ciciro, Mara Quill": who has changes waiting, in the order they appear. */
export function suggestionAuthors(list: readonly SuggestionSummary[], someone: string): string {
  return [...new Set(list.map((s) => s.authorName.trim() || someone))].join(", ");
}

/**
 * Whether a paragraph holds a pending suggestion. The grammar pass rewrites a
 * paragraph from its plain text, which would turn a pending deletion into
 * permanent strikethrough, so it leaves these paragraphs alone.
 */
export function blockHasSuggestions(html: string, blockId: string): boolean {
  if (!hasSuggestions(html)) return false;
  const block = htmlToDoc(html, 0).doc.blocks.find((b) => b.id === blockId);
  return block ? hasSuggestions(block.html) : false;
}

export function clipText(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
