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

/**
 * How many words Ciciro has contributed to a chapter (or manuscript) since
 * tracking began: words from a suggestion the author accepted, plus prose
 * Ciciro inserted directly (a "Continue writing" paste, an auto-draft).
 * Counted once, permanently, at the moment of acceptance or insertion - a
 * later edit to that passage does not move the word back to the author's
 * side, and a later deletion does not lower the count. These are cumulative
 * counts, so they are never expressed as a share of the chapter's current
 * words: that denominator shrinks and grows with revision while the counts
 * only grow, and dividing one by the other would misstate the figure.
 */
export type AiInvolvement = {
  /** Words that started as an accepted Ciciro suggestion. */
  acceptedWords: number;
  /** Words Ciciro inserted directly, with no suggestion to accept. */
  draftedWords: number;
  ciciroWords: number;
  /** When counting began (the earliest, across a manuscript); null if unknown. */
  since: Date | null;
};

type AiInvolvementChapter = {
  aiAcceptedWords?: number;
  aiDraftedWords?: number;
  aiInvolvementSince?: string | Date | null;
};

function trackingStart(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function aiInvolvement(chapter: AiInvolvementChapter): AiInvolvement {
  return manuscriptAiInvolvement([chapter]);
}

/** The same tally across every chapter passed in, for a manuscript-wide figure. */
export function manuscriptAiInvolvement(chapters: readonly AiInvolvementChapter[]): AiInvolvement {
  let acceptedWords = 0;
  let draftedWords = 0;
  let since: Date | null = null;
  for (const c of chapters) {
    acceptedWords += Math.max(0, c.aiAcceptedWords ?? 0);
    draftedWords += Math.max(0, c.aiDraftedWords ?? 0);
    const start = trackingStart(c.aiInvolvementSince);
    if (start && (!since || start < since)) since = start;
  }
  return { acceptedWords, draftedWords, ciciroWords: acceptedWords + draftedWords, since };
}

/** "1,234 words from Ciciro (1,000 accepted suggestions, 234 inserted directly)". */
export function describeAiInvolvement(involvement: AiInvolvement): string {
  const n = (x: number) => x.toLocaleString();
  const noun = involvement.ciciroWords === 1 ? "word" : "words";
  return (
    `${n(involvement.ciciroWords)} ${noun} from Ciciro ` +
    `(${n(involvement.acceptedWords)} from accepted suggestions, ` +
    `${n(involvement.draftedWords)} inserted directly)`
  );
}
