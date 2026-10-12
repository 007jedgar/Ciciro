// The text a share link's link preview (Open Graph / Twitter card) shows:
// "{author} is sending you their {kind} {title}". Pure text logic only - no
// database access - so it is reused by the metadata route, the image route
// and tests alike. src/lib/shares.ts's `sharePreviewInfo` is the one place
// that decides whether a link is live enough to say any of this out loud;
// everything here just shapes the words once that decision is already made.

import { isManuscriptKind } from "@/lib/manuscript-kind";
import { cleanLine } from "@/lib/share-view";

/** Longest author name shown in a preview before it is truncated. */
export const SHARE_PREVIEW_AUTHOR_MAX = 60;
/** Longest manuscript title shown in a preview before it is truncated. */
export const SHARE_PREVIEW_TITLE_MAX = 80;

const DEFAULT_AUTHOR = "A writer";
const DEFAULT_TITLE = "Untitled Manuscript";

/** The noun a preview uses for each manuscript kind. Unknown kinds (or a
 *  project row with no recognizable kind at all) read as the generic
 *  "manuscript" rather than guessing - unlike the editor's own `normalizeKind`,
 *  which assumes "novel" because it has to render *something*. */
const KIND_WORDS: Record<string, string> = {
  novel: "novel",
  screenplay: "screenplay",
  blog: "article",
  journal: "journal",
};

const FALLBACK_KIND_WORD = "manuscript";

export function shareKindWord(kind: unknown): string {
  if (!isManuscriptKind(kind)) return FALLBACK_KIND_WORD;
  return KIND_WORDS[kind] ?? FALLBACK_KIND_WORD;
}

/** Cut `value` to at most `max` characters, breaking on a word boundary and
 *  marking the cut with an ellipsis when the break lands late enough to still
 *  read naturally. */
function truncateGracefully(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, Math.max(0, max - 1));
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

export type SharePreviewSource = {
  author: string;
  title: string;
  /** The project's raw `kind` column - not yet validated as a ManuscriptKind. */
  kind: unknown;
};

/** The three pieces of the preview sentence, each already cleaned, bounded
 *  and defaulted so the caller never has to special-case an empty field. */
export type SharePreviewParts = {
  author: string;
  kindWord: string;
  title: string;
};

// cleanLine's own `max` just slices (no ellipsis), so it is given generous
// headroom here and truncateGracefully does the real, word-aware cut.
const CLEAN_LINE_HEADROOM = 10_000;

export function sharePreviewParts(source: SharePreviewSource): SharePreviewParts {
  const author =
    truncateGracefully(cleanLine(source.author, CLEAN_LINE_HEADROOM), SHARE_PREVIEW_AUTHOR_MAX) || DEFAULT_AUTHOR;
  const title =
    truncateGracefully(cleanLine(source.title, CLEAN_LINE_HEADROOM), SHARE_PREVIEW_TITLE_MAX) || DEFAULT_TITLE;
  return { author, kindWord: shareKindWord(source.kind), title };
}

/** The preview sentence as one line of plain text, for a card's description. */
export function sharePreviewSentence(parts: SharePreviewParts): string {
  return `${parts.author} is sending you their ${parts.kindWord} ${parts.title}`;
}
