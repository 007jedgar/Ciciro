// Small text helpers shared between server and client.

import { diffArrays } from "diff";
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
 * Words `afterHtml` adds to `beforeHtml`'s prose as it stands (pending
 * suggestions unapplied, as `chapterWordCount` reads it), by a word-level
 * diff: a replacement counts its new words, a deletion counts nothing, and a
 * pending suggestion counts only once it is accepted. An edit too scattered to
 * diff cheaply falls back to its net growth.
 */
export function chapterWordsAdded(beforeHtml: string, afterHtml: string): number {
  const before = proseWords(beforeHtml);
  const after = proseWords(afterHtml);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const removed = before.slice(start, endBefore);
  const added = after.slice(start, endAfter);
  if (added.length === 0) return 0;
  if (removed.length === 0) return added.length;
  const changes = diffArrays(removed, added, { maxEditLength: WORD_DIFF_LIMIT });
  if (!changes) return Math.max(0, added.length - removed.length);
  return changes.reduce((n, change) => (change.added ? n + change.count : n), 0);
}

const WORD_DIFF_LIMIT = 2_000;

function proseWords(html: string): string[] {
  const text = chapterPlainText(html).trim();
  return text ? text.split(/\s+/) : [];
}

/**
 * How much of what was added to a chapter (or manuscript) since tracking
 * began came from Ciciro. Both sides are running totals, counted once at the
 * moment of writing and never lowered by a later edit or deletion:
 * `acceptedWords` from Ciciro suggestions the author accepted, `draftedWords`
 * from prose Ciciro inserted directly (a "Continue writing" paste, an
 * auto-draft, insert_text), and `wordsAdded` from every word added by anyone
 * (see `chapterWordsAdded`). `percent` divides the Ciciro total by
 * `wordsAdded`, never by the chapter's current length, which shrinks and grows
 * with revision while the tallies only grow.
 */
export type AiInvolvement = {
  /** Words that started as an accepted Ciciro suggestion. */
  acceptedWords: number;
  /** Words Ciciro inserted directly, with no suggestion to accept. */
  draftedWords: number;
  ciciroWords: number;
  /** Every word added since tracking began; never below `ciciroWords`. */
  wordsAdded: number;
  /** `wordsAdded` less Ciciro's share: what the author wrote themselves. */
  authorWords: number;
  /** 0-100, rounded: `ciciroWords` as a share of `wordsAdded`. */
  percent: number;
  /** When counting began (the earliest, across a manuscript); null if unknown. */
  since: Date | null;
};

type AiInvolvementChapter = {
  aiAcceptedWords?: number;
  aiDraftedWords?: number;
  wordsAdded?: number;
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
  let wordsAdded = 0;
  let since: Date | null = null;
  for (const c of chapters) {
    const accepted = Math.max(0, c.aiAcceptedWords ?? 0);
    const drafted = Math.max(0, c.aiDraftedWords ?? 0);
    acceptedWords += accepted;
    draftedWords += drafted;
    // The two sides are counted by different writes, so one can land before
    // the other; a chapter's total never reads below its own Ciciro share.
    wordsAdded += Math.max(c.wordsAdded ?? 0, accepted + drafted);
    const start = trackingStart(c.aiInvolvementSince);
    if (start && (!since || start < since)) since = start;
  }
  const ciciroWords = acceptedWords + draftedWords;
  return {
    acceptedWords,
    draftedWords,
    ciciroWords,
    wordsAdded,
    authorWords: wordsAdded - ciciroWords,
    percent: wordsAdded > 0 ? Math.round((ciciroWords / wordsAdded) * 100) : 0,
    since,
  };
}

/**
 * "12% of the 1,000 words added came from Ciciro (100 from accepted
 * suggestions, 20 inserted directly); 880 you wrote yourself".
 */
export function describeAiInvolvement(involvement: AiInvolvement): string {
  const n = (x: number) => x.toLocaleString();
  const noun = involvement.wordsAdded === 1 ? "word" : "words";
  return (
    `${involvement.percent}% of the ${n(involvement.wordsAdded)} ${noun} added came from Ciciro ` +
    `(${n(involvement.acceptedWords)} from accepted suggestions, ` +
    `${n(involvement.draftedWords)} inserted directly); ` +
    `${n(involvement.authorWords)} you wrote yourself`
  );
}
