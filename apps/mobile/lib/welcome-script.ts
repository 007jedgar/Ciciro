import type { ManuscriptKind } from "./manuscript-kind";

/**
 * The welcome screen's page writing itself, as data. `welcomeSteps` is a
 * generator of frames (what the headline and the card show, and how long to
 * wait before showing it), so the sequence is plain and testable and the
 * component only plays it: a timer per frame, paused whenever the screen is
 * not on show.
 *
 * The story: a page types out a novel's first lines; a caret rewrites the
 * headline from "Write the book you keep meaning to." to "Keep writing the book
 * you've been meaning to."; then the headline's word is backspaced and retyped
 * through every kind of writing in `WELCOME_KINDS`, and each time the card's
 * old text is highlighted, deleted and replaced with realistic copy for that
 * form. The sentence's edits are derived from the translated strings
 * (`diffEdit`), so every language edits its own words.
 */

/** The order the loop visits the kinds in; the first is what the card opens on. Every `MANUSCRIPT_KINDS` entry is here (a test pins it). */
export const WELCOME_KINDS: readonly ManuscriptKind[] = ["novel", "journal", "screenplay", "blog"];

export type CardRole = "prose" | "date" | "title" | "subtitle" | "body" | "scene" | "action" | "character" | "dialogue";

/** The look of each block of a kind's card copy, in order: `welcome.card.<kind>.blocks` has one string per entry. */
export const CARD_ROLES: Record<ManuscriptKind, CardRole[]> = {
  novel: ["prose"],
  journal: ["date", "prose"],
  screenplay: ["scene", "action", "character", "dialogue"],
  blog: ["title", "subtitle", "body"],
};

export type WelcomeCopy = {
  /** The headline as first written, around the swappable word. */
  before: string;
  after: string;
  /** The headline after the caret has rewritten it. */
  beforeFinal: string;
  afterFinal: string;
  /** The swappable word per kind (it carries its own article or measure word where the language needs one). */
  words: Record<ManuscriptKind, string>;
  /** What the card says per kind: a label and one string per block. */
  cards: Record<ManuscriptKind, { label: string; blocks: string[] }>;
};

export type HeadlinePart = "before" | "word" | "after";

export type HeadlineFrame = {
  before: string;
  word: string;
  after: string;
  /** Where the caret stands, as a UTF-16 offset into that part. */
  caret: { part: HeadlinePart; at: number } | null;
  /** Highlighted text, as UTF-16 offsets into that part. */
  selection: { part: HeadlinePart; from: number; to: number } | null;
  /** The caret blinks while the page waits and holds still while typing. */
  blink: boolean;
};

export type CardFrame = {
  kind: ManuscriptKind;
  label: string;
  /** The text typed so far in each block; blocks not started yet are absent. */
  typed: string[];
  /** The block the caret is in, or null for no caret. */
  caret: number | null;
  /** All the card's text is highlighted, about to be deleted. */
  selected: boolean;
};

export type WelcomeFrame = { headline: HeadlineFrame; card: CardFrame };
export type WelcomeStep = { wait: number; frame: WelcomeFrame };

// ---- timing (ms) --------------------------------------------------------------
/** Typing the card: a few letters per frame so a paragraph is a few dozen renders, not a few hundred. */
export const CARD_TYPE_MS = 24;
export const CARD_TYPE_CHUNK = 2;
export const CARD_BLOCK_PAUSE_MS = 110;
/** The blinking caret waits at the end of the headline before it goes back to the start. */
export const HEADLINE_BLINK_MS = 1300;
export const HEADLINE_MOVE_MS = 420;
export const HEADLINE_SELECT_MS = 440;
export const HEADLINE_TYPE_MS = 50;
export const HEADLINE_BACKSPACE_MS = 52;
/** After the headline word is rewritten, how long the finished page rests before the next kind. */
export const KIND_HOLD_MS = 2000;
export const KIND_TURN_MS = 140;
export const KIND_TYPE_MS = 62;
/** The old card text stays highlighted this long before it is deleted. */
export const CARD_SELECT_MS = 520;
export const CARD_AFTER_DELETE_MS = 160;

// ---- graphemes and edits ------------------------------------------------------
// Combining marks, Devanagari signs and vowel signs, joiners and variation selectors stay with the letter before them.
const JOINS_BEFORE = /[̀-ͯऀ-ःऺ-ॏ॑-ॗॢॣ‌‍︀-️]/;
const VIRAMA = "्";

/** Splits text into what a reader sees as one letter each, so a typed Hindi syllable never shows half-formed. */
export function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const ch of Array.from(text)) {
    const last = out.length - 1;
    if (last >= 0 && (JOINS_BEFORE.test(ch) || out[last].endsWith(VIRAMA) || out[last].endsWith("‍"))) {
      out[last] += ch;
    } else {
      out.push(ch);
    }
  }
  return out;
}

export type Edit = { at: number; deleted: string; inserted: string };

/** The one edit that turns `from` into `to`: what stays at each end is kept, the middle is replaced. Null when they match. */
export function diffEdit(from: string, to: string): Edit | null {
  if (from === to) return null;
  const a = graphemes(from);
  const b = graphemes(to);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    at: a.slice(0, prefix).join("").length,
    deleted: a.slice(prefix, a.length - suffix).join(""),
    inserted: b.slice(prefix, b.length - suffix).join(""),
  };
}

// ---- frames -------------------------------------------------------------------
function cloneFrame(headline: HeadlineFrame, card: CardFrame): WelcomeFrame {
  return {
    headline: {
      ...headline,
      caret: headline.caret && { ...headline.caret },
      selection: headline.selection && { ...headline.selection },
    },
    card: { ...card, typed: [...card.typed] },
  };
}

/** The page before anything is typed: the first headline, an empty card, a caret waiting in it. */
export function initialFrame(copy: WelcomeCopy): WelcomeFrame {
  const card = copy.cards.novel;
  return cloneFrame(
    { before: copy.before, word: copy.words.novel, after: copy.after, caret: null, selection: null, blink: false },
    { kind: "novel", label: card.label, typed: [], caret: 0, selected: false }
  );
}

/** A finished page for `kind`: the rewritten headline and the card fully typed, no caret (Reduce motion, and what is read aloud). */
export function settledFrame(copy: WelcomeCopy, kind: ManuscriptKind): WelcomeFrame {
  const card = copy.cards[kind];
  return cloneFrame(
    { before: copy.beforeFinal, word: copy.words[kind], after: copy.afterFinal, caret: null, selection: null, blink: false },
    { kind, label: card.label, typed: [...card.blocks], caret: null, selected: false }
  );
}

/** The rewritten headline with the novel word: the one sentence a screen reader says. */
export function headlineSentence(copy: WelcomeCopy): string {
  return `${copy.beforeFinal}${copy.words.novel}${copy.afterFinal}`;
}

/** A little deterministic unevenness, so typing reads as a person's and a test can still pin it. */
function uneven(base: number, index: number, char: string): number {
  const wobble = 0.8 + ((index * 7) % 5) * 0.1;
  const breath = ",.;:。，।".includes(char) ? base * 2 : 0;
  return Math.round(base * wobble + breath);
}

/**
 * The whole sequence, endless: it ends one lap of the kinds and begins the next.
 * The first frame it yields follows `initialFrame`.
 */
export function* welcomeSteps(copy: WelcomeCopy): Generator<WelcomeStep, never, undefined> {
  const h: HeadlineFrame = initialFrame(copy).headline;
  const c: CardFrame = initialFrame(copy).card;
  const snap = (wait: number): WelcomeStep => ({ wait, frame: cloneFrame(h, c) });

  function* typeCard(kind: ManuscriptKind, lead: number): Generator<WelcomeStep, void, undefined> {
    const card = copy.cards[kind];
    c.kind = kind;
    c.label = card.label;
    c.typed = [];
    c.selected = false;
    c.caret = 0;
    yield snap(lead);
    for (let b = 0; b < card.blocks.length; b += 1) {
      c.caret = b;
      c.typed[b] = "";
      if (b > 0) yield snap(CARD_BLOCK_PAUSE_MS);
      const letters = graphemes(card.blocks[b]);
      for (let i = 0; i < letters.length; i += CARD_TYPE_CHUNK) {
        c.typed[b] += letters.slice(i, i + CARD_TYPE_CHUNK).join("");
        yield snap(uneven(CARD_TYPE_MS, i, letters[i]));
      }
    }
    c.caret = null;
    yield snap(CARD_BLOCK_PAUSE_MS);
  }

  function* typeInto(part: HeadlinePart, text: string, base: number): Generator<WelcomeStep, void, undefined> {
    const letters = graphemes(text);
    for (let i = 0; i < letters.length; i += 1) {
      const at = h.caret?.at ?? 0;
      h[part] = h[part].slice(0, at) + letters[i] + h[part].slice(at);
      h.caret = { part, at: at + letters[i].length };
      yield snap(uneven(base, i, letters[i]));
    }
  }

  function* rewrite(part: "before" | "after", to: string): Generator<WelcomeStep, void, undefined> {
    const edit = diffEdit(h[part], to);
    if (!edit) return;
    h.caret = { part, at: edit.at };
    h.blink = false;
    yield snap(HEADLINE_MOVE_MS);
    if (edit.deleted) {
      h.selection = { part, from: edit.at, to: edit.at + edit.deleted.length };
      h.caret = null;
      yield snap(HEADLINE_SELECT_MS);
      h[part] = h[part].slice(0, edit.at) + h[part].slice(edit.at + edit.deleted.length);
      h.selection = null;
      h.caret = { part, at: edit.at };
      yield snap(160);
    }
    yield* typeInto(part, edit.inserted, HEADLINE_TYPE_MS);
  }

  // 1. The card's first lines are typed in (the dots have just become lines and shrunk to a caret).
  yield* typeCard("novel", 0);

  // 2. The caret waits at the end of the headline, blinking, then goes back and rewrites the sentence.
  h.caret = { part: "after", at: h.after.length };
  h.blink = true;
  yield snap(HEADLINE_MOVE_MS);
  h.blink = false;
  yield* rewrite("before", copy.beforeFinal);
  yield* rewrite("after", copy.afterFinal);
  h.caret = { part: "word", at: h.word.length };
  h.blink = true;
  yield snap(HEADLINE_MOVE_MS);

  // 3. Every kind of writing, round and round.
  for (;;) {
    for (const kind of WELCOME_KINDS.slice(1).concat(WELCOME_KINDS[0])) {
      h.caret = { part: "word", at: h.word.length };
      h.blink = false;
      yield snap(KIND_HOLD_MS);
      const gone = graphemes(h.word);
      for (let i = gone.length - 1; i >= 0; i -= 1) {
        h.word = gone.slice(0, i).join("");
        h.caret = { part: "word", at: h.word.length };
        yield snap(HEADLINE_BACKSPACE_MS);
      }
      yield* typeInto("word", copy.words[kind], KIND_TYPE_MS);
      // The card: old text highlighted, deleted, new text typed.
      c.selected = true;
      c.caret = null;
      h.caret = { part: "word", at: h.word.length };
      yield snap(KIND_TURN_MS);
      yield snap(CARD_SELECT_MS);
      c.selected = false;
      c.typed = [];
      c.label = copy.cards[kind].label;
      c.kind = kind;
      c.caret = 0;
      yield snap(1);
      yield* typeCard(kind, CARD_AFTER_DELETE_MS);
      h.blink = true;
      yield snap(1);
    }
  }
}
