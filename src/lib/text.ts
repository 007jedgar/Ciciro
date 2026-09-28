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
 * How much of a chapter's (or manuscript's) words started as Ciciro text: a
 * suggestion the author accepted, or prose Ciciro inserted directly (a
 * "Continue writing" paste, an auto-draft). Counted once, permanently, at
 * the moment of acceptance or insertion - a later edit to that passage does
 * not move the word back to the author's side, and a later deletion does not
 * lower the count. `ciciroWords` is clamped to the chapter's current word
 * count so the percentage never reads over 100%, which heavy revision could
 * otherwise produce.
 */
export type AiInvolvement = {
  totalWords: number;
  /** Words that started as an accepted Ciciro suggestion or an inserted draft. */
  ciciroWords: number;
  authorWords: number;
  /** 0-100, rounded. */
  percent: number;
};

type AiInvolvementChapter = {
  wordCount: number;
  aiAcceptedWords?: number;
  aiDraftedWords?: number;
};

export function aiInvolvement(chapter: AiInvolvementChapter): AiInvolvement {
  const totalWords = Math.max(0, chapter.wordCount);
  const ciciroWords = Math.min(
    totalWords,
    Math.max(0, (chapter.aiAcceptedWords ?? 0) + (chapter.aiDraftedWords ?? 0))
  );
  return {
    totalWords,
    ciciroWords,
    authorWords: totalWords - ciciroWords,
    percent: totalWords > 0 ? Math.round((ciciroWords / totalWords) * 100) : 0,
  };
}

/** The same tally across every chapter passed in, for a manuscript-wide figure. */
export function manuscriptAiInvolvement(chapters: readonly AiInvolvementChapter[]): AiInvolvement {
  return aiInvolvement(
    chapters.reduce<{ wordCount: number; aiAcceptedWords: number; aiDraftedWords: number }>(
      (sum, c) => ({
        wordCount: sum.wordCount + Math.max(0, c.wordCount),
        aiAcceptedWords: sum.aiAcceptedWords + Math.max(0, c.aiAcceptedWords ?? 0),
        aiDraftedWords: sum.aiDraftedWords + Math.max(0, c.aiDraftedWords ?? 0),
      }),
      { wordCount: 0, aiAcceptedWords: 0, aiDraftedWords: 0 }
    )
  );
}
