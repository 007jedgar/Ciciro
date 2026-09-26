// Small text helpers shared between server and client.

import { htmlWithoutSuggestions } from "@/lib/suggestions";

// Strip HTML tags to plain text. Block tags become newlines so paragraphs survive.
export function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/**
 * A chapter's prose as it stands, as plain text. Pending suggestions are not
 * applied: suggested deletions are still there, suggested insertions are not,
 * so a replacement never reads as both halves run together.
 */
export function chapterPlainText(html: string): string {
  return htmlToText(htmlWithoutSuggestions(html));
}

/** Words in a chapter's HTML, with pending suggestions left unapplied. */
export function chapterWordCount(html: string): number {
  return countWords(chapterPlainText(html));
}

/** True when TipTap HTML has no prose (empty `<p></p>` counts as empty). */
export function isChapterEmpty(content: string): boolean {
  return countWords(htmlToText(content)) === 0;
}

// Pull prose out of the assistant's <draft>...</draft> block, if present.
export function extractDraft(reply: string): string | null {
  const match = reply.match(/<draft>([\s\S]*?)<\/draft>/i);
  return match ? match[1].trim() : null;
}
