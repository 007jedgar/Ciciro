import type { ManuscriptKind } from "./manuscript-kind";

// The menu that opens over highlighted text, on the desk and on the phone.
// Two or more words get Comment, Rewrite, Describe, Expand and Fix; one word
// gets Comment, Describe and Fix with synonyms beside them. This file holds
// everything the two apps agree on: what a selection is, which actions it
// offers, the briefs those actions send Ciciro, and the synonym request, its
// cache and the case-matching of a chosen synonym.
//
// The Expo app cannot import from the Next app, so apps/mobile/lib/selection-menu.ts
// is a byte-for-byte copy and test/selection-menu-parity.test.ts fails when
// they drift. Edit one, copy it over the other.

export type SelectionKind = "none" | "word" | "passage";

export type SelectionActionId = "comment" | "rewrite" | "describe" | "expand" | "fix";

/** The actions that send Ciciro a brief; Comment opens the chat for the author to write instead. */
export type SelectionBriefId = Exclude<SelectionActionId, "comment">;

const WORDLIKE = /[\p{L}\p{N}]/u;

/**
 * Two or more words make a passage and exactly one makes a word. Punctuation
 * and spaces alone, like an empty selection, offer nothing.
 */
export function selectionKind(text: string): SelectionKind {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((part) => WORDLIKE.test(part));
  if (words.length === 0) return "none";
  return words.length === 1 ? "word" : "passage";
}

const ACTIONS: Record<Exclude<SelectionKind, "none">, SelectionActionId[]> = {
  word: ["comment", "describe", "fix"],
  passage: ["comment", "rewrite", "describe", "expand", "fix"],
};

/** The menu's buttons for a selection, in the order they show. */
export function selectionActionsFor(kind: SelectionKind): SelectionActionId[] {
  return kind === "none" ? [] : ACTIONS[kind];
}

const BRIEFS: Record<SelectionBriefId, string> = {
  rewrite:
    "Rewrite the selected text so it says the same thing in fresher words. Keep my voice, tense, point of view and every fact. Return the rewrite in a <draft> block, then one line on what you changed.",
  describe:
    "Add sensory description to the selected text: what can be seen, heard, smelled or felt, in specific concrete detail that fits the story bible. Do not stall the scene or add plot. Return the text with the description worked in as a <draft> block.",
  expand:
    "Expand the selected text with more detail, interiority and beat-by-beat action, to about one and a half to two times its length, in my voice, tense and point of view. Do not add new plot events. Return the expanded text in a <draft> block.",
  fix: "Fix the selected text: spelling, grammar, punctuation and any clear slip such as a repeated word or a wrong tense. Change as little as possible and keep my voice and my wording. Return the corrected text in a <draft> block, then list each fix on its own line. If nothing needs fixing, say so and return no <draft> block.",
};

const SCREENPLAY_NOTE = " Write it as marked script lines, one element per line.";
const JOURNAL_NOTE = " This is my journal: keep every fact as I wrote it and do not invent anything that did not happen.";

/** What an action asks Ciciro to do with the selection. Model instructions, so they stay in English. */
export function selectionBrief(action: SelectionBriefId, kind: ManuscriptKind): string {
  const brief = BRIEFS[action];
  if (kind === "screenplay") return `${brief}${SCREENPLAY_NOTE}`;
  if (kind === "journal") return `${brief}${JOURNAL_NOTE}`;
  return brief;
}

/** The chat turn an action sends: a quick-action style turn scoped to the selected text. */
export const SELECTION_TURN = { kind: "action", scope: "selection" } as const;

const QUOTE_MAX = 80;

/**
 * The line a Comment starts the composer with, so the author can see what the
 * chat is about: the selection, trimmed to fit, in curly quotes.
 */
export function commentQuote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const shown = flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX - 1).trimEnd()}…` : flat;
  return `“${shown}” `;
}

// ---------------------------------------------------------------- synonyms

/** A word picked out of a selection, with whatever hugged it (spaces, quotes, a full stop). */
export type SplitWord = { lead: string; word: string; trail: string };

/** Split a one-word selection into the word and the characters around it, or null when it has no word. */
export function splitWord(text: string): SplitWord | null {
  const found = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(text);
  if (!found || !found[2]) return null;
  return { lead: found[1], word: found[2], trail: found[3] };
}

const SYNONYM_WORD = /^\p{L}[\p{L}'’-]*$/u;

/** Only real words get synonyms: not numbers, not a single letter, not a long run of text. */
export function synonymEligible(word: string): boolean {
  return word.length >= 2 && word.length <= 32 && SYNONYM_WORD.test(word);
}

/** What the model sees to pick synonyms that fit: the word and a little of the sentence around it. */
export type SynonymContext = { word: string; before: string; after: string };

/** Most synonyms a lookup returns, best fit first. */
export const SYNONYM_LIMIT = 30;

const CONTEXT_CHARS = 200;
const SENTENCE_END = /[.!?…]["'”’)\]]*\s+/g;

/**
 * The words of a block either side of the selected word, cut to the sentence
 * it sits in. `block` is one paragraph's plain text and `start`/`end` index it.
 */
export function synonymContext(block: string, start: number, end: number): SynonymContext {
  const word = block.slice(start, end);
  let before = block.slice(Math.max(0, start - CONTEXT_CHARS), start);
  let sentenceStart = 0;
  for (const match of before.matchAll(SENTENCE_END)) sentenceStart = (match.index ?? 0) + match[0].length;
  before = before.slice(sentenceStart);
  let after = block.slice(end, end + CONTEXT_CHARS);
  const stop = /[.!?…]["'”’)\]]*(\s|$)/.exec(after);
  if (stop) after = after.slice(0, stop.index + stop[0].trimEnd().length);
  return { word, before, after };
}

/** A chosen synonym in the case the word had: "Country" takes "Homeland", "COUNTRY" takes "HOMELAND". */
export function matchCase(original: string, replacement: string): string {
  if (!replacement) return replacement;
  const letters = original.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return replacement.toUpperCase();
  }
  const first = original.match(/\p{L}/u)?.[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    const lead = replacement.match(/\p{L}/u);
    if (lead && lead.index !== undefined && lead[0] === lead[0].toLowerCase()) {
      return replacement.slice(0, lead.index) + lead[0].toUpperCase() + replacement.slice(lead.index + 1);
    }
  }
  return replacement;
}

/** Two lookups of the same word in the same sentence share an answer. */
export function synonymCacheKey(context: SynonymContext): string {
  const before = context.before.slice(-60).toLowerCase();
  const after = context.after.slice(0, 60).toLowerCase();
  return `${context.word.toLowerCase()}\u0000${before}\u0000${after}`;
}

type SynonymFetcher = (context: SynonymContext) => Promise<string[]>;

/**
 * A synonym lookup that remembers its answers: the last `limit` words come
 * straight back, and a second ask for a word still on its way waits for the
 * first instead of sending another request. A failed fetch is never kept, so
 * the next selection tries again. The request is shared, so it is never
 * aborted for one caller: a caller that has moved on just ignores the answer.
 */
export function createSynonymLookup(fetcher: SynonymFetcher, limit = 60): SynonymFetcher {
  const done = new Map<string, string[]>();
  const pending = new Map<string, Promise<string[]>>();
  return (context) => {
    const key = synonymCacheKey(context);
    const cached = done.get(key);
    if (cached) {
      done.delete(key);
      done.set(key, cached);
      return Promise.resolve(cached);
    }
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const request = fetcher(context).then(
      (list) => {
        pending.delete(key);
        if (list.length > 0) {
          done.set(key, list);
          if (done.size > limit) done.delete(done.keys().next().value as string);
        }
        return list;
      },
      (error: unknown) => {
        pending.delete(key);
        throw error;
      }
    );
    pending.set(key, request);
    return request;
  };
}
