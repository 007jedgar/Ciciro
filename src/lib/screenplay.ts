/**
 * Screenplay form, shared by the desk, the server, and the phone: the element
 * model, the page engine, and the structure of a script. The Expo app cannot
 * import from the Next app, so apps/mobile/lib/screenplay.ts is a byte-for-byte
 * copy; test/screenplay-parity.test.ts fails when they drift. No imports, no
 * I/O, no DOM.
 *
 * A screenplay stays ordinary block HTML: an element is the `data-sp`
 * attribute on a paragraph, and "action" is its absence. Everything below is
 * derived from that. The page is fixed: 12pt Courier at 10 characters an inch,
 * a 60 column measure and 54 lines a page, so a pure function can say which
 * words land on which line and which line lands on which page. The editor's
 * `ch` units, the page markers, the "about N pages" count, and the PDF writer
 * all call this one layout, so none of them can disagree.
 */

// --- Elements ----------------------------------------------------------------

export const SCREENPLAY_ELEMENTS = [
  "scene-heading",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
  "shot",
  "centered",
] as const;
export type ScreenplayElement = (typeof SCREENPLAY_ELEMENTS)[number];

export const SCREENPLAY_ELEMENT_LABELS: Record<ScreenplayElement, string> = {
  "scene-heading": "Scene heading",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
  shot: "Shot",
  centered: "Centered",
};

export const SCREENPLAY_ATTR = "data-sp";
/**
 * Set to "1" on the character cue that opens the second speech of a dual
 * dialogue pair: the speech sits beside the one right above it (Fountain's `^`).
 * An older client drops it when it rewrites the block; that costs the pairing,
 * never the words.
 */
export const SCREENPLAY_DUAL_ATTR = "data-sp-dual";

export function isScreenplayElement(value: unknown): value is ScreenplayElement {
  return typeof value === "string" && (SCREENPLAY_ELEMENTS as readonly string[]).includes(value);
}

// A tag is written into an attribute, so only a plain slug is kept.
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/**
 * The element tag to store for a `data-sp` value. Forward compatible: a value
 * this build does not know (a newer client's `centered`, say) is kept as it is,
 * never collapsed to action, so an older client editing the block cannot strip
 * it. Absent, blank, or not a plain slug reads as "action".
 */
export function elementTag(value: unknown): string {
  if (typeof value !== "string") return "action";
  const tag = value.trim();
  return TAG_PATTERN.test(tag) ? tag : "action";
}

/** A stored tag as an element this build knows, or null for a newer client's. */
export function knownElement(tag: string | null | undefined): ScreenplayElement | null {
  return isScreenplayElement(tag) ? tag : null;
}

/**
 * The element to lay out and to act on: a tag this build does not know behaves
 * as action here, but `elementTag` is what gets stored, so it survives.
 */
export function normalizeElement(value: unknown): ScreenplayElement {
  return isScreenplayElement(value) ? value : "action";
}

/** Tab walks this ring; Shift-Tab walks it backwards. */
const CYCLE: readonly ScreenplayElement[] = [
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
  "shot",
  "centered",
  "scene-heading",
];

export function cycleElement(current: ScreenplayElement, direction: 1 | -1 = 1): ScreenplayElement {
  const at = CYCLE.indexOf(current);
  return CYCLE[(at + direction + CYCLE.length) % CYCLE.length];
}

const AFTER_ENTER: Record<ScreenplayElement, ScreenplayElement> = {
  "scene-heading": "action",
  action: "action",
  character: "dialogue",
  dialogue: "action",
  parenthetical: "dialogue",
  transition: "scene-heading",
  shot: "action",
  centered: "action",
};

/** The element a new block takes when Enter splits or ends `current`. */
export function nextElementOnEnter(current: ScreenplayElement): ScreenplayElement {
  return AFTER_ENTER[current];
}

/**
 * The element shortcuts, in the order of the digits that choose them: Alt+Shift
 * plus 1 to 8. Never Cmd/Ctrl+digit: browsers keep those for switching tabs,
 * and Ctrl+Alt is AltGr on many Windows layouts.
 */
export const SHORTCUT_ORDER: readonly ScreenplayElement[] = [
  "scene-heading",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "shot",
  "transition",
  "centered",
];

/** The digit (1 to 8) that chooses `element` with Alt+Shift. */
export function shortcutDigit(element: ScreenplayElement): number {
  return SHORTCUT_ORDER.indexOf(element) + 1;
}

/** The element the digit chooses, or null for a digit with no shortcut. */
export function elementForShortcutDigit(digit: number | string): ScreenplayElement | null {
  const n = typeof digit === "number" ? digit : Number(digit);
  return Number.isInteger(n) ? (SHORTCUT_ORDER[n - 1] ?? null) : null;
}

/** The opening tag of a block, and the `data-sp` value inside it. */
function openingTag(html: string): string {
  return html.match(/^<[a-z][\w-]*\b([^>]*)>/i)?.[1] ?? "";
}

/** Read the element tag off a block's opening tag, unknown tags kept. */
export function elementTagOfHtml(html: string): string {
  const m = openingTag(html).match(/\bdata-sp\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return elementTag(m?.[1] ?? m?.[2] ?? m?.[3]);
}

/** Read the element off a block's opening tag. An element this build does not know reads as action. */
export function elementOfHtml(html: string): ScreenplayElement {
  return normalizeElement(elementTagOfHtml(html));
}

/**
 * Set (or, for action, clear) the element on a block's opening tag. Takes any
 * tag, so a block carrying a newer client's element keeps it when restamped.
 */
export function withElement(html: string, element: string): string {
  const tag = elementTag(element);
  return html.replace(/^<([a-z][\w-]*)\b([^>]*)>/i, (_full, name: string, attrs: string) => {
    let bare = attrs.replace(/\s*\bdata-sp\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    // Only a cue can open the second speech of a dual pair.
    if (tag !== "character") bare = bare.replace(DUAL_ATTR_RE, "");
    return tag === "action" ? `<${name}${bare}>` : `<${name}${bare} ${SCREENPLAY_ATTR}="${tag}">`;
  });
}

const DUAL_ATTR_RE = /\s*\bdata-sp-dual\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;

/** Whether a block's opening tag says its speech sits beside the one above it. */
export function dualOfHtml(html: string): boolean {
  const m = openingTag(html).match(/\bdata-sp-dual\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const value = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return value === "1" || value === "true";
}

/** Set or clear the dual-dialogue flag on a block's opening tag. */
export function withDual(html: string, dual: boolean): string {
  return html.replace(/^<([a-z][\w-]*)\b([^>]*)>/i, (_full, name: string, attrs: string) => {
    const bare = attrs.replace(DUAL_ATTR_RE, "");
    return dual ? `<${name}${bare} ${SCREENPLAY_DUAL_ATTR}="1">` : `<${name}${bare}>`;
  });
}

// --- The page ----------------------------------------------------------------

/** Columns across the text area: 6.0 inches at 10 characters an inch. */
export const PAGE_COLUMNS = 60;
/** Lines down the text area: 9.0 inches at 6 lines an inch. */
export const PAGE_LINES = 54;

export type ElementMetrics = {
  /** Columns in from the left margin. */
  indent: number;
  /** Columns the element may fill. */
  width: number;
  align: "left" | "right" | "center";
  /** Set in capitals. */
  caps: boolean;
  bold: boolean;
};

/**
 * Where each element sits, in columns from the 1.5 inch left margin (the
 * report's section 2.2, from Final Draft's margins and the Nicholl guide). The
 * character cue's position varies by source; it is the one most worth tuning.
 * The editor's CSS (`ch` units in globals.css) mirrors this table;
 * test/screenplay-css.test.ts fails when they drift.
 */
export const ELEMENT_METRICS: Record<ScreenplayElement, ElementMetrics> = {
  "scene-heading": { indent: 0, width: 60, align: "left", caps: true, bold: true },
  action: { indent: 0, width: 60, align: "left", caps: false, bold: false },
  character: { indent: 22, width: 38, align: "left", caps: true, bold: false },
  dialogue: { indent: 10, width: 35, align: "left", caps: false, bold: false },
  parenthetical: { indent: 16, width: 25, align: "left", caps: false, bold: false },
  transition: { indent: 30, width: 30, align: "right", caps: true, bold: false },
  shot: { indent: 0, width: 60, align: "left", caps: true, bold: false },
  centered: { indent: 0, width: 60, align: "center", caps: false, bold: false },
};

export type DualSide = "left" | "right";

/**
 * Where a speech sits when it shares the page with another (dual dialogue): two
 * columns of 28 with a gap of 4, the left one starting at the margin. Only a
 * cue, a parenthetical and dialogue are ever set this way. Mirrored by the
 * editor's CSS (test/screenplay-css.test.ts).
 */
export const DUAL_METRICS: Record<DualSide, Partial<Record<ScreenplayElement, { indent: number; width: number }>>> = {
  left: {
    character: { indent: 8, width: 20 },
    parenthetical: { indent: 4, width: 20 },
    dialogue: { indent: 0, width: 28 },
  },
  right: {
    character: { indent: 40, width: 20 },
    parenthetical: { indent: 36, width: 20 },
    dialogue: { indent: 32, width: 28 },
  },
};

/** Elements that stay on the page with the block after them. */
const KEEP_WITH_NEXT: ReadonlySet<ScreenplayElement> = new Set([
  "scene-heading",
  "shot",
  "character",
  "parenthetical",
]);

/** Elements a page may break in the middle of, with two lines left on each side. */
const SPLITTABLE: ReadonlySet<ScreenplayElement> = new Set(["action", "dialogue", "centered"]);

/**
 * Blank lines between a block and the one before it: one, except that a
 * parenthetical or a line of dialogue answering the line above it sits
 * directly under it. The editor's CSS draws the same rule with adjacent
 * sibling selectors.
 */
export const SPEECH_RUNS: readonly (readonly [ScreenplayElement, ScreenplayElement])[] = [
  ["character", "parenthetical"],
  ["dialogue", "parenthetical"],
  ["character", "dialogue"],
  ["parenthetical", "dialogue"],
];

export function blankLinesBefore(element: ScreenplayElement, above: ScreenplayElement | null): number {
  if (above === null) return 1;
  return SPEECH_RUNS.some(([a, b]) => a === above && b === element) ? 0 : 1;
}

/** What the engine lays out: an element tag and the block's plain text (`\n` for a hard break). */
export type ScriptBlock = {
  element: string;
  text: string;
  /** A cue that opens the second speech of a dual-dialogue pair: it sits beside the speech above. */
  dual?: boolean;
};

export type LaidOutLine = {
  /** The line as set on the page: capitals applied, a parenthetical's brackets on. */
  text: string;
  /** Where the line starts in the block's own text, for putting a page marker in the middle of a block. */
  start: number;
};

export type LaidOutBlock = {
  index: number;
  /** The element laid out; one this build does not know sets as action. */
  element: ScreenplayElement;
  /** Blank lines above, dropped at the top of a page. */
  before: number;
  lines: LaidOutLine[];
  indent: number;
  width: number;
  align: "left" | "right" | "center";
  bold: boolean;
  /** Set when the block is a speech of a dual-dialogue pair: the column it sits in, and which pair. */
  dual?: { side: DualSide; pair: number };
};

/** How many 10-pitch columns a character fills: 0 for a combining mark, 2 for a wide one. */
function columns(cp: number): number {
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x200b && cp <= 0x200d) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  ) {
    return 0;
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

const isLetter = (ch: string): boolean => ch.toLowerCase() !== ch.toUpperCase();
const isAlnum = (ch: string): boolean => isLetter(ch) || (ch >= "0" && ch <= "9");

/** Capitals, one for one: a character whose capital is longer (ß) stays as it is, so offsets hold. */
function upper(text: string): string {
  const all = text.toUpperCase();
  if (all.length === text.length) return all;
  let out = "";
  for (const ch of text) {
    const up = ch.toUpperCase();
    out += up.length === ch.length ? up : ch;
  }
  return out;
}

/**
 * Greedy word wrap the way a browser sets `white-space: pre-wrap` in a
 * monospace face: break after spaces and after a hyphen inside a word, let
 * spaces hang off the end of a line, keep leading spaces, and break a word
 * longer than the measure where it overflows. `\n` starts a new line, and so
 * do the line and paragraph separators (U+2028, U+2029) that pasted text can
 * carry, as they do in a browser.
 */
export function wrapText(text: string, width: number): LaidOutLine[] {
  const out: LaidOutLine[] = [];
  const hardBreak = /[\n\u2028\u2029]/g;
  let hardStart = 0;
  for (;;) {
    hardBreak.lastIndex = hardStart;
    const hardEnd = hardBreak.exec(text)?.index ?? -1;
    const end = hardEnd === -1 ? text.length : hardEnd;
    wrapRun(text, hardStart, end, width, out);
    if (hardEnd === -1) break;
    hardStart = hardEnd + 1;
  }
  return out;
}

function wrapRun(text: string, from: number, to: number, width: number, out: LaidOutLine[]): void {
  const push = (start: number, stop: number) => {
    out.push({ text: text.slice(start, stop).replace(/ +$/, ""), start });
  };
  let lineStart = from;
  let col = 0;
  let placed = false; // a word is on the current line
  let wrapped = false; // the current line began with a soft wrap
  let i = from;
  while (i < to) {
    const spaceStart = i;
    while (i < to && text[i] === " ") i++;
    let spaces = i - spaceStart;
    const wordStart = i;
    let w = 0;
    while (i < to && text[i] !== " ") {
      const cp = text.codePointAt(i) ?? 0;
      const len = cp > 0xffff ? 2 : 1;
      w += columns(cp);
      i += len;
      // A hyphen between letters or digits is a place a line may break.
      if (text[i - 1] === "-" && i - 2 >= wordStart && isAlnum(text[i - 2]) && i < to && isLetter(text[i])) break;
    }
    if (!placed && wrapped) {
      // Spaces left hanging off the line above do not start this one.
      spaces = 0;
      lineStart = wordStart;
    }
    if (col + spaces + w <= width) {
      col += spaces + w;
      placed = true;
      continue;
    }
    if (placed) {
      push(lineStart, spaceStart);
      lineStart = wordStart;
      col = 0;
      placed = false;
      wrapped = true;
      spaces = 0;
    }
    if (spaces + w <= width) {
      col = spaces + w;
      placed = true;
      continue;
    }
    // Longer than a line: fill the line, break where it overflows.
    col = spaces;
    let j = wordStart;
    while (j < i) {
      const cp = text.codePointAt(j) ?? 0;
      const len = cp > 0xffff ? 2 : 1;
      const cw = columns(cp);
      if (col + cw > width && j > lineStart) {
        push(lineStart, j);
        lineStart = j;
        col = 0;
      }
      col += cw;
      j += len;
    }
    placed = true;
    wrapped = true;
  }
  push(lineStart, to);
}

/**
 * Set one block on the page: its lines, indent, and the blank lines above it.
 * `side` sets a speech in one column of a dual-dialogue pair.
 */
export function layoutBlock(
  block: ScriptBlock,
  above: ScreenplayElement | null,
  index = 0,
  side?: DualSide
): LaidOutBlock {
  const element = normalizeElement(block.element);
  const metrics = ELEMENT_METRICS[element];
  const column = side ? DUAL_METRICS[side][element] : undefined;
  const indent = column?.indent ?? metrics.indent;
  const width = column?.width ?? metrics.width;
  let text = block.text;
  let prefix = 0;
  if (element === "parenthetical") {
    text = `(${text})`;
    prefix = 1;
  } else if (metrics.caps) {
    text = upper(text);
  }
  const lines = wrapText(text, width).map((line) => ({
    text: line.text,
    start: Math.max(0, line.start - prefix),
  }));
  return {
    index,
    element,
    before: blankLinesBefore(element, above),
    lines,
    indent,
    width,
    align: metrics.align,
    bold: metrics.bold,
  };
}

/** Lines a column of a dual pair takes: its blocks and the blank lines between them. */
function columnRows(column: readonly LaidOutBlock[]): number {
  return column.reduce((sum, b, n) => sum + (n > 0 ? b.before : 0) + b.lines.length, 0);
}

/** A pair no taller than this is set side by side; a taller one falls back to two speeches in turn. */
const DUAL_MAX_ROWS = PAGE_LINES - 2;

type DualPlan = { side: DualSide; pair: number; groupStart: number; pairStart: number };

/** Which blocks sit in which column of which pair, for the pairs that fit on a page. */
function planDual(blocks: readonly ScriptBlock[]): Map<number, DualPlan> {
  const plan = new Map<number, DualPlan>();
  dualPairs(blocks).forEach(({ left, right }, pair) => {
    const set = (group: DialogueGroup, side: DualSide): LaidOutBlock[] => {
      const out: LaidOutBlock[] = [];
      for (let i = group.start; i < group.end; i++) {
        out.push(layoutBlock(blocks[i], i === group.start ? null : out[out.length - 1].element, i, side));
      }
      return out;
    };
    const rows = Math.max(columnRows(set(left, "left")), columnRows(set(right, "right")));
    if (rows > DUAL_MAX_ROWS) return;
    for (const [group, side] of [[left, "left"], [right, "right"]] as const) {
      for (let i = group.start; i < group.end; i++) {
        plan.set(i, { side, pair, groupStart: group.start, pairStart: left.start });
      }
    }
  });
  return plan;
}

/** Set a run of blocks on the page. */
export function layout(blocks: readonly ScriptBlock[]): LaidOutBlock[] {
  const dual = planDual(blocks);
  const out: LaidOutBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const plan = dual.get(i);
    if (!plan) {
      out.push(layoutBlock(blocks[i], i === 0 ? null : out[i - 1].element, i));
      continue;
    }
    // The first block of each column hangs from whatever is above the pair; the rest answer the block above in their own column.
    const above =
      i === plan.groupStart ? (plan.pairStart === 0 ? null : out[plan.pairStart - 1].element) : out[i - 1].element;
    const laid = layoutBlock(blocks[i], above, i, plan.side);
    laid.dual = { side: plan.side, pair: plan.pair };
    out.push(laid);
  }
  return out;
}

// --- Dual dialogue and speeches --------------------------------------------------

export type DualPair = { left: DialogueGroup; right: DialogueGroup };

/**
 * The speeches that sit side by side: a cue flagged `dual` pairs its speech
 * with the one directly above it (the two touch, with nothing between). A
 * speech joins at most one pair, so a flag on the speech after a pair's second
 * is ignored, as is one with no speech right above it.
 */
export function dualPairs(blocks: readonly ScriptBlock[]): DualPair[] {
  const groups = dialogueGroups(blocks);
  const out: DualPair[] = [];
  for (let g = 1; g < groups.length; g++) {
    const left = groups[g - 1];
    const right = groups[g];
    if (!blocks[right.character].dual || left.end !== right.start) continue;
    if (out.length > 0 && out[out.length - 1].right === left) continue;
    out.push({ left, right });
  }
  return out;
}

export const MORE_TEXT = "(MORE)";
export const CONTD_TEXT = "(CONT'D)";

/** A cue as it is set at the top of the page its speech runs on to: its name with `(CONT'D)` after it. */
export function contdCue(cue: string): string {
  const name = cue.trim();
  return /\(\s*cont(?:['’]d|\.)\s*\)\s*$/i.test(name) ? upper(name) : upper(`${name} ${CONTD_TEXT}`);
}

const contdCache = new WeakMap<LaidOutBlock, LaidOutLine[]>();

/** The lines of the cue repeated at the top of a page, each with its place in the cue's own text. */
function contdLines(cue: LaidOutBlock): LaidOutLine[] {
  let lines = contdCache.get(cue);
  if (!lines) {
    lines = wrapText(contdCue(cue.lines.map((l) => l.text).join(" ")), ELEMENT_METRICS.character.width);
    contdCache.set(cue, lines);
  }
  return lines;
}

/** Whether a scene heading carries a scene number: any with words in it. */
export function isNumberedScene(element: string, text: string): boolean {
  return normalizeElement(element) === "scene-heading" && text.trim() !== "";
}

// --- Pagination --------------------------------------------------------------

/** Where the next line goes: `line` lines of `page` are used. A fresh script is page 1, line 0. */
export type PageCursor = { page: number; line: number };

export const SCRIPT_START: PageCursor = { page: 1, line: 0 };

/** What shapes the pages besides the words: the dialogue-break notes. */
export type PageOptions = {
  /** `(MORE)` closes a page a speech runs past. Default on. */
  more?: boolean;
  /** The cue is set again with `(CONT'D)` at the top of the next page. Default on. */
  contd?: boolean;
  /** Scene headings carry numbers in both margins. Default off. */
  sceneNumbers?: boolean;
};

/** A page begins here: `line` lines into block `block` (0: just before it). */
export type PageBreak = {
  /** The page that begins. */
  page: number;
  block: number;
  line: number;
  /** The character offset in the block's text of that line. */
  offset: number;
  /** The cue's block when the break falls inside a speech (it runs on to this page), else null. */
  speech: number | null;
  /** `(MORE)` is set on the last line of the page above. */
  more: boolean;
  /** The cue is set again, with `(CONT'D)`, on the first line of this page. */
  contd: boolean;
};

export type Pagination = {
  breaks: PageBreak[];
  /** Where the next line would go; the start of the next sequence. */
  end: PageCursor;
  /** The page number `end` has reached, counting a part page; 0 for a script with nothing on it. */
  pages: number;
};

/** Pages a cursor has reached, 0 for the start of an empty script. */
export function pagesAt(cursor: PageCursor): number {
  return cursor.page === 1 && cursor.line === 0 ? 0 : cursor.page;
}

type Speech = { cue: number; last: number };

/** What the paginator places: a block, or both speeches of a dual pair as one. */
type Item = {
  first: number;
  /** Laid-out block indexes: one, or all of a dual pair's. */
  blocks: number[];
  before: number;
  /** Lines it takes, blank lines inside it included. */
  rows: number;
  dual: boolean;
  /** The speech a plain block belongs to, for `(MORE)` and `(CONT'D)`. */
  speech: Speech | null;
};

function buildItems(laid: readonly LaidOutBlock[]): Item[] {
  const speechAt = new Map<number, Speech>();
  for (let i = 0; i < laid.length; i++) {
    if (laid[i].dual || laid[i].element !== "character") continue;
    let end = i + 1;
    while (
      end < laid.length &&
      !laid[end].dual &&
      (laid[end].element === "parenthetical" || laid[end].element === "dialogue")
    ) {
      end++;
    }
    const speech = { cue: i, last: end - 1 };
    for (let k = i; k < end; k++) speechAt.set(k, speech);
    i = end - 1;
  }
  const items: Item[] = [];
  for (let i = 0; i < laid.length; ) {
    const b = laid[i];
    if (b.dual) {
      const pair = b.dual.pair;
      let j = i;
      while (j < laid.length && laid[j].dual?.pair === pair) j++;
      const blocks = Array.from({ length: j - i }, (_, n) => i + n);
      const column = (side: DualSide) => blocks.filter((k) => laid[k].dual?.side === side).map((k) => laid[k]);
      items.push({
        first: i,
        blocks,
        before: b.before,
        rows: Math.max(columnRows(column("left")), columnRows(column("right"))),
        dual: true,
        speech: null,
      });
      i = j;
    } else {
      items.push({ first: i, blocks: [i], before: b.before, rows: b.lines.length, dual: false, speech: speechAt.get(i) ?? null });
      i++;
    }
  }
  return items;
}

/** Lines of an item that must be on a page for it to begin there. */
function minStart(item: Item, laid: readonly LaidOutBlock[], more: boolean): number {
  if (item.dual) return item.rows;
  const b = laid[item.first];
  const n = item.rows;
  const inSpeech = more && item.speech !== null;
  if (SPLITTABLE.has(b.element) && n >= 4) return 2 + (inSpeech ? 1 : 0);
  // A block that does not split needs room to finish; a speech that goes on after it needs a line for (MORE) too.
  return n + (inSpeech && item.first < item.speech!.last ? 1 : 0);
}

/** Lines that must fit on the page to begin item `k`, with the chain of items it keeps with. */
function startNeed(items: readonly Item[], laid: readonly LaidOutBlock[], k: number, more: boolean): number {
  let need = 0;
  for (let j = k; j < items.length; j++) {
    const item = items[j];
    if (!item.dual && KEEP_WITH_NEXT.has(laid[item.first].element) && j + 1 < items.length) {
      need += item.before + item.rows;
      if (need > PAGE_LINES) return need;
      continue;
    }
    return need + item.before + minStart(item, laid, more);
  }
  return need;
}

/**
 * Break laid-out blocks into pages. A scene heading, shot, cue, or parenthetical
 * stays with what follows; an action or speech breaks across a page only with
 * two lines on each side; anything else moves whole, and so does a dual-dialogue
 * pair. A speech that runs past a page ends it with `(MORE)` and is begun again
 * with its cue and `(CONT'D)`; both take a line, and each can be turned off. The
 * "about a minute a page" rule is still a rule of thumb, not a measurement.
 */
export function paginate(laid: readonly LaidOutBlock[], opts: PageOptions & { start?: PageCursor } = {}): Pagination {
  const more = opts.more !== false;
  const contd = opts.contd !== false;
  const items = buildItems(laid);
  const breaks: PageBreak[] = [];
  let page = opts.start?.page ?? 1;
  let line = opts.start?.line ?? 0;
  // Lines already on a page when it begins: the repeated cue, when there is one.
  let floor = 0;
  // The page begins with a repeated cue, so the block under it follows it directly.
  let bare = false;

  /** A page begins `at` lines into `block`. */
  const turn = (block: number, at: number, speech: Speech | null) => {
    const inside = speech !== null && (at > 0 || block > speech.cue);
    page++;
    floor = inside && contd ? contdLines(laid[speech.cue]).length : 0;
    line = floor;
    bare = floor > 0;
    breaks.push({
      page,
      block,
      line: at,
      offset: at === 0 ? 0 : laid[block].lines[at].start,
      speech: inside ? speech.cue : null,
      more: inside && more,
      contd: inside && contd,
    });
  };

  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    const need = startNeed(items, laid, k, more);
    if (line > 0 && line + need > PAGE_LINES && need <= PAGE_LINES) turn(item.first, 0, item.speech);
    if (line > 0 && !bare) line += item.before;

    if (item.dual) {
      // Both speeches at once, as tall as the taller; never split.
      const room = PAGE_LINES - line;
      line += Math.min(item.rows, room);
      bare = false;
      continue;
    }

    const b = laid[item.first];
    const speech = item.speech;
    const midMore = more && speech ? 1 : 0;
    const endMore = more && speech && item.first < speech.last ? 1 : 0;
    const total = b.lines.length;
    let placed = 0;
    while (placed < total) {
      const room = PAGE_LINES - line;
      const left = total - placed;
      if (left + endMore <= room) {
        line += left;
        break;
      }
      let take = 0;
      if (SPLITTABLE.has(b.element)) {
        take = Math.min(room - midMore, left - 2);
        if (placed === 0 && take < 2) take = 0;
      }
      if (take <= 0) {
        if (line > floor) {
          turn(item.first, placed, speech);
          continue;
        }
        take = room; // Taller than a page and not one to split: it has to.
      }
      line += take;
      placed += take;
      turn(item.first, placed, speech);
    }
    bare = false;
  }

  const end = { page, line };
  return { breaks, end, pages: pagesAt(end) };
}

/** One cell of a typeset row: a stretch of one block's text, and where it sits. */
export type PageCell = {
  text: string;
  indent: number;
  width: number;
  align: "left" | "right" | "center";
  bold: boolean;
  block: number;
  /** Where the cell's text starts in its block's own text. */
  start: number;
  /** Characters at the front of the cell that are not in the block's text (a parenthetical's bracket). */
  lead: number;
};

/** One row of a typeset page; null is a blank line. */
export type PageRow =
  | (PageCell & {
      /** The sequence (chapter) the row belongs to: 0 for a single run of blocks. */
      sequence: number;
      /** Set on the notes the engine adds itself: `(MORE)` and the repeated cue. Their text is not in any block. */
      synthetic?: "more" | "contd";
      /** The scene's number, on the first row of a numbered scene heading. */
      sceneNumber?: string;
      /** The right-hand column of a dual-dialogue row; the cell above is the left. */
      right?: PageCell;
    })
  | null;

export type Typeset = {
  /** The pages, line by line. */
  pages: PageRow[][];
  /** One pagination per sequence, each started where the one before ended. */
  paginations: Pagination[];
  /** Where the next line would go. */
  end: PageCursor;
  /** How many pages the script runs, counting a part page; 0 for nothing on it. */
  count: number;
};

function cellOf(b: LaidOutBlock, line: LaidOutLine, at: number): PageCell {
  return {
    text: line.text,
    indent: b.indent,
    width: b.width,
    align: b.align,
    bold: b.bold,
    block: b.index,
    start: line.start,
    lead: b.element === "parenthetical" && at === 0 ? 1 : 0,
  };
}

/**
 * The pages themselves, line by line: what the PDF writer draws and what a
 * golden fixture pins. Starts at a fresh page; each sequence runs on from the
 * one before with continuous page numbers, exactly as `sequenceCursors` counts.
 */
export function typesetSequences(sequences: readonly (readonly ScriptBlock[])[], opts: PageOptions = {}): Typeset {
  const pages: PageRow[][] = [[]];
  const paginations: Pagination[] = [];
  let cursor = SCRIPT_START;
  let scenes = 0;
  sequences.forEach((blocks, sequence) => {
    const laid = layout(blocks);
    const pagination = paginate(laid, { ...opts, start: cursor });
    paginations.push(pagination);
    cursor = pagination.end;
    let next = 0;
    let bare = false;
    /** Begin the page the engine says starts here: close the one above with (MORE), open this one with the cue. */
    const turn = (block: number, line: number) => {
      const brk = pagination.breaks[next];
      if (!brk || brk.block !== block || brk.line !== line) return;
      next++;
      const characterAt = ELEMENT_METRICS.character;
      if (brk.more && brk.speech !== null) {
        pages[pages.length - 1].push({
          text: MORE_TEXT,
          indent: characterAt.indent,
          width: characterAt.width,
          align: "left",
          bold: false,
          sequence,
          block: Math.max(0, block - (line === 0 ? 1 : 0)),
          start: 0,
          lead: 0,
          synthetic: "more",
        });
      }
      pages.push([]);
      if (brk.contd && brk.speech !== null) {
        for (const l of contdLines(laid[brk.speech])) {
          pages[pages.length - 1].push({
            text: l.text,
            indent: characterAt.indent,
            width: characterAt.width,
            align: "left",
            bold: false,
            sequence,
            block: brk.speech,
            start: 0,
            lead: 0,
            synthetic: "contd",
          });
        }
        bare = true;
      }
    };

    for (const item of buildItems(laid)) {
      if (item.dual) {
        turn(item.first, 0);
        const page = pages[pages.length - 1];
        if (page.length > 0 && !bare) for (let n = 0; n < item.before; n++) page.push(null);
        bare = false;
        const column = (side: DualSide): (PageCell | null)[] => {
          const cells: (PageCell | null)[] = [];
          item.blocks
            .map((k) => laid[k])
            .filter((b) => b.dual?.side === side)
            .forEach((b, n) => {
              if (n > 0) for (let j = 0; j < b.before; j++) cells.push(null);
              b.lines.forEach((l, at) => cells.push(cellOf(b, l, at)));
            });
          return cells;
        };
        const left = column("left");
        const right = column("right");
        const lastLeft = item.blocks.filter((k) => laid[k].dual?.side === "left").pop() ?? item.first;
        for (let r = 0; r < Math.max(left.length, right.length); r++) {
          const l = left[r] ?? null;
          const rc = right[r] ?? null;
          if (!l && !rc) {
            page.push(null);
            continue;
          }
          const lead: PageCell = l ?? {
            text: "",
            indent: 0,
            width: DUAL_METRICS.left.dialogue!.width,
            align: "left",
            bold: false,
            block: lastLeft,
            start: 0,
            lead: 0,
          };
          page.push({ ...lead, sequence, ...(rc ? { right: rc } : {}) });
        }
        continue;
      }

      const b = laid[item.first];
      const numbered = isNumberedScene(b.element, b.lines.map((l) => l.text).join(""));
      if (numbered) scenes++;
      let lineAt = 0;
      while (lineAt < b.lines.length) {
        turn(b.index, lineAt);
        const page = pages[pages.length - 1];
        if (lineAt === 0 && page.length > 0 && !bare) for (let n = 0; n < b.before; n++) page.push(null);
        bare = false;
        page.push({
          ...cellOf(b, b.lines[lineAt], lineAt),
          sequence,
          ...(numbered && lineAt === 0 && opts.sceneNumbers ? { sceneNumber: String(scenes) } : {}),
        });
        lineAt++;
      }
    }
  });
  return { pages: pages.filter((p) => p.length > 0), paginations, end: cursor, count: pagesAt(cursor) };
}

/** One run of blocks on a fresh page; see `typesetSequences`. */
export function typeset(
  blocks: readonly ScriptBlock[],
  opts: PageOptions = {}
): { pages: PageRow[][]; pagination: Pagination } {
  const set = typesetSequences([blocks], opts);
  return { pages: set.pages, pagination: set.paginations[0] };
}

/** Where a cell starts on its line, in columns from the page's left margin. */
function cellPad(cell: PageCell): number {
  if (cell.align === "right") return cell.indent + cell.width - cell.text.length;
  if (cell.align === "center") return cell.indent + Math.floor((cell.width - cell.text.length) / 2);
  return cell.indent;
}

/**
 * A typeset script as plain text, one string per page, for fixtures and
 * debugging. A dual row has both columns on one line. With `sceneNumbers` the
 * margins show: a scene's number sits at the left and the right of its heading.
 */
export function pagesAsText(pages: readonly PageRow[][], opts: { sceneNumbers?: boolean } = {}): string[] {
  const gutter = opts.sceneNumbers ? 5 : 0;
  return pages.map((page) =>
    page
      .map((row) => {
        if (!row) return "";
        let text = " ".repeat(Math.max(0, cellPad(row))) + row.text;
        if (row.right) text = text.padEnd(Math.max(0, cellPad(row.right))) + row.right.text;
        if (!opts.sceneNumbers) return text;
        const left = row.sceneNumber ? `${row.sceneNumber}`.padEnd(gutter) : " ".repeat(gutter);
        const tail = row.sceneNumber ? text.padEnd(row.indent + row.width) + `  ${row.sceneNumber}` : text;
        return left + tail;
      })
      .join("\n")
  );
}

// --- Chapter HTML ------------------------------------------------------------

const BLOCK_RE = /<(p|h[1-6]|li|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** A stretch of a block's text with one set of inline marks. */
export type StyledRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean };

/** A script block with its inline marks: the runs' text, joined, is the block's text. */
export type StyledBlock = { element: string; runs: StyledRun[]; dual?: boolean };

const INLINE_TOKEN_RE = /<[^>]*>|[^<]+|</g;

/** The runs inside one block's HTML: `<br>` a line break, bold, italic and underline kept, other tags dropped. */
function runsFromInner(inner: string): StyledRun[] {
  const runs: StyledRun[] = [];
  let bold = 0;
  let italic = 0;
  let underline = 0;
  const add = (text: string) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && !!last.bold === bold > 0 && !!last.italic === italic > 0 && !!last.underline === underline > 0) {
      last.text += text;
      return;
    }
    const run: StyledRun = { text };
    if (bold > 0) run.bold = true;
    if (italic > 0) run.italic = true;
    if (underline > 0) run.underline = true;
    runs.push(run);
  };
  for (const token of inner.match(INLINE_TOKEN_RE) ?? []) {
    if (token.length > 1 && token[0] === "<" && token.endsWith(">")) {
      const m = token.match(/^<(\/?)([a-z][\w-]*)/i);
      if (!m) continue;
      const name = m[2].toLowerCase();
      if (name === "br") {
        if (!m[1]) add("\n");
      } else if (name === "strong" || name === "b") {
        bold = Math.max(0, bold + (m[1] ? -1 : 1));
      } else if (name === "em" || name === "i") {
        italic = Math.max(0, italic + (m[1] ? -1 : 1));
      } else if (name === "u") {
        underline = Math.max(0, underline + (m[1] ? -1 : 1));
      }
    } else {
      add(decodeEntities(token));
    }
  }
  return runs;
}

/**
 * A chapter's block HTML as styled script blocks: the element off each
 * paragraph, `<br>` as a line break, bold / italic / underline kept as runs,
 * other tags dropped, entities decoded. A heading, quote, or list item (what
 * StarterKit's input rules can still make) sets as action.
 */
export function styledBlocksFromHtml(html: string): StyledBlock[] {
  const out: StyledBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(html))) {
    const element = m[1].toLowerCase() === "p" ? elementTagOfHtml(m[0]) : "action";
    out.push({
      element,
      runs: runsFromInner(m[3]),
      ...(element === "character" && dualOfHtml(m[0]) ? { dual: true } : {}),
    });
  }
  return out;
}

/** The text of a run of styled runs. */
export function runsText(runs: readonly StyledRun[]): string {
  return runs.map((r) => r.text).join("");
}

/** The part of `runs` between two character offsets in their joined text. */
export function sliceRuns(runs: readonly StyledRun[], from: number, to: number): StyledRun[] {
  const out: StyledRun[] = [];
  let at = 0;
  for (const run of runs) {
    const start = Math.max(from, at);
    const stop = Math.min(to, at + run.text.length);
    if (stop > start) out.push({ ...run, text: run.text.slice(start - at, stop - at) });
    at += run.text.length;
    if (at >= to) break;
  }
  return out;
}

/** A chapter's block HTML as script blocks; see `styledBlocksFromHtml`. */
export function scriptBlocksFromHtml(html: string): ScriptBlock[] {
  return styledBlocksFromHtml(html).map((block) => ({
    element: block.element,
    text: runsText(block.runs),
    ...(block.dual ? { dual: true } : {}),
  }));
}

const LAYOUT_CACHE_MIN = 64;
let layoutCacheMax = LAYOUT_CACHE_MIN;
const layoutCache = new Map<string, LaidOutBlock[]>();

/**
 * `layout(scriptBlocksFromHtml(html))`, remembered for the last chapters asked
 * about: at least as many as the longest script scanned, so a scan over every
 * sequence on each keystroke lays out only the one that changed.
 */
export function layoutHtml(html: string): LaidOutBlock[] {
  const hit = layoutCache.get(html);
  if (hit) {
    layoutCache.delete(html);
    layoutCache.set(html, hit);
    return hit;
  }
  const laid = layout(scriptBlocksFromHtml(html));
  layoutCache.set(html, laid);
  while (layoutCache.size > layoutCacheMax) {
    const oldest = layoutCache.keys().next().value;
    if (oldest === undefined) break;
    layoutCache.delete(oldest);
  }
  return laid;
}

/**
 * Where each sequence of a script starts on the page, and where the script
 * ends. Sequences run on from one another with continuous page numbers.
 */
export function sequenceCursors(
  chapters: readonly string[],
  opts: PageOptions = {}
): { starts: PageCursor[]; end: PageCursor; scenesBefore: number[]; scenes: number } {
  layoutCacheMax = Math.max(layoutCacheMax, chapters.length + LAYOUT_CACHE_MIN);
  const starts: PageCursor[] = [];
  const scenesBefore: number[] = [];
  let cursor: PageCursor = SCRIPT_START;
  let scenes = 0;
  for (const html of chapters) {
    const laid = layoutHtml(html);
    starts.push(cursor);
    scenesBefore.push(scenes);
    cursor = paginate(laid, { ...opts, start: cursor }).end;
    for (const b of laid) if (isNumberedScene(b.element, b.lines.map((l) => l.text).join(""))) scenes++;
  }
  return { starts, end: cursor, scenesBefore, scenes };
}

/** How many pages a script runs, from its sequences' HTML in order. 0 for an empty one. */
export function estimatePages(chapters: readonly string[], opts: PageOptions = {}): number {
  return pagesAt(sequenceCursors(chapters, opts).end);
}

// --- Structure ---------------------------------------------------------------

export type SceneRange = {
  /** The scene heading's block index, or null for blocks ahead of the first heading. */
  heading: number | null;
  start: number;
  /** One past the last block. */
  end: number;
};

/** A script's scenes: each runs from a scene heading to the next. */
export function scenes(blocks: readonly ScriptBlock[]): SceneRange[] {
  const out: SceneRange[] = [];
  blocks.forEach((block, i) => {
    if (normalizeElement(block.element) === "scene-heading") {
      if (out.length > 0) out[out.length - 1].end = i;
      out.push({ heading: i, start: i, end: blocks.length });
    } else if (out.length === 0) {
      out.push({ heading: null, start: 0, end: blocks.length });
    }
  });
  return out;
}

export type DialogueGroup = {
  /** The cue's block index. */
  character: number;
  start: number;
  /** One past the last parenthetical or line of dialogue. */
  end: number;
};

/** A cue and the parentheticals and dialogue under it. */
export function dialogueGroups(blocks: readonly ScriptBlock[]): DialogueGroup[] {
  const out: DialogueGroup[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (normalizeElement(blocks[i].element) !== "character") continue;
    let end = i + 1;
    while (end < blocks.length) {
      const el = normalizeElement(blocks[end].element);
      if (el !== "parenthetical" && el !== "dialogue") break;
      end++;
    }
    out.push({ character: i, start: i, end });
    i = end - 1;
  }
  return out;
}

// --- Script languages ----------------------------------------------------------

/**
 * The languages script formatting is built for: the Courier page, capitals and
 * the PDF's WinAnsi text cover English and Spanish. Other languages are planned.
 */
export const SCRIPT_LANGUAGES: readonly string[] = ["en", "es"];

/** Whether script formatting (the screenplay PDF, creating a script) is available in a language code such as "en" or "es-MX". */
export function scriptLanguageSupported(language: string | null | undefined): boolean {
  if (!language) return true;
  return SCRIPT_LANGUAGES.includes(language.toLowerCase().split(/[-_]/)[0]);
}

/**
 * Whether a script's own text is in a writing system the screenplay PDF can
 * set (Latin, which covers English and Spanish): false when more than a third
 * of its characters are Han, Devanagari, Cyrillic, Arabic and the like. Digits,
 * punctuation, symbols, emoji and spaces say nothing either way.
 */
export function scriptTextSupported(text: string): boolean {
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x250 || (cp >= 0x1e00 && cp <= 0x1eff)) {
      if (isLetter(ch)) latin++;
    } else if (!((cp >= 0x2000 && cp <= 0x2bff) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp >= 0x1f000 && cp <= 0x1faff)) {
      other++;
    }
  }
  return other <= (latin + other) / 3;
}

/**
 * Whether a whole script, given as its sequences' chapter HTML (and, if it is
 * to be set, the title page's text), is in text the screenplay PDF can set:
 * `scriptTextSupported` over every sequence's text joined. The server's export, the web menu and the phone all ask this, each
 * with the live sequences and pending suggestions already removed.
 */
export function scriptHtmlSupported(chapters: readonly string[], extraText = ""): boolean {
  return scriptTextSupported(
    [...chapters.map((html) => styledBlocksFromHtml(html).map((b) => runsText(b.runs)).join("\n")), extraText].join("\n")
  );
}

// --- Script settings -------------------------------------------------------------

/** The words on a title page. Blank fields fall back (see `resolveTitlePage`) or are left out. */
export type TitlePage = {
  title: string;
  credit: string;
  author: string;
  source: string;
  draftDate: string;
  /** Several lines: name, address, email, phone, agent. */
  contact: string;
};

export const TITLE_PAGE_FIELDS: readonly (keyof TitlePage)[] = [
  "title",
  "credit",
  "author",
  "source",
  "draftDate",
  "contact",
];

/** The longest each field may be. Stored text is cut to this. */
export const TITLE_PAGE_LIMITS: Record<keyof TitlePage, number> = {
  title: 200,
  credit: 100,
  author: 200,
  source: 200,
  draftDate: 60,
  contact: 600,
};

/**
 * The settings that belong to one script, not to the writer: the title page,
 * the dialogue-break notes, scene numbers. Stored on the manuscript as one JSON
 * string (`Project.scriptSettings`, empty for all defaults).
 */
export type ScriptSettings = {
  titlePage: TitlePage;
  /** The PDF opens with a title page. Default on. */
  showTitlePage: boolean;
  /** `(MORE)` at the foot of a page a speech runs past. Default on. */
  more: boolean;
  /** The cue again, with `(CONT'D)`, at the top of the next page. Default on. */
  contd: boolean;
  /** Numbers on scene headings, in both margins of the PDF and as `#n#` in Fountain. Default off. */
  sceneNumbers: boolean;
};

export const EMPTY_TITLE_PAGE: TitlePage = { title: "", credit: "", author: "", source: "", draftDate: "", contact: "" };

export const DEFAULT_SCRIPT_SETTINGS: ScriptSettings = {
  titlePage: EMPTY_TITLE_PAGE,
  showTitlePage: true,
  more: true,
  contd: true,
  sceneNumbers: false,
};

function cleanLine(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanLines(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, limit);
}

/** A title page from anything stored or sent: unknown keys dropped, text cleaned and cut to length. */
export function normalizeTitlePage(value: unknown): TitlePage {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    title: cleanLine(source.title, TITLE_PAGE_LIMITS.title),
    credit: cleanLine(source.credit, TITLE_PAGE_LIMITS.credit),
    author: cleanLine(source.author, TITLE_PAGE_LIMITS.author),
    source: cleanLine(source.source, TITLE_PAGE_LIMITS.source),
    draftDate: cleanLine(source.draftDate, TITLE_PAGE_LIMITS.draftDate),
    contact: cleanLines(source.contact, TITLE_PAGE_LIMITS.contact),
  };
}

/**
 * Script settings from what the manuscript row holds (a JSON string, or the
 * object it parses to). Forgiving: anything missing or malformed is its default,
 * so a newer client's keys are ignored and an empty string is all defaults.
 */
export function parseScriptSettings(raw: unknown): ScriptSettings {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return DEFAULT_SCRIPT_SETTINGS;
    try {
      value = JSON.parse(raw);
    } catch {
      return DEFAULT_SCRIPT_SETTINGS;
    }
  }
  if (!value || typeof value !== "object") return DEFAULT_SCRIPT_SETTINGS;
  const v = value as Record<string, unknown>;
  const flag = (key: string, fallback: boolean) => (typeof v[key] === "boolean" ? (v[key] as boolean) : fallback);
  return {
    titlePage: normalizeTitlePage(v.titlePage),
    showTitlePage: flag("showTitlePage", DEFAULT_SCRIPT_SETTINGS.showTitlePage),
    more: flag("more", DEFAULT_SCRIPT_SETTINGS.more),
    contd: flag("contd", DEFAULT_SCRIPT_SETTINGS.contd),
    sceneNumbers: flag("sceneNumbers", DEFAULT_SCRIPT_SETTINGS.sceneNumbers),
  };
}

/** The string to store: empty when every setting is its default, else the normalized JSON. */
export function serializeScriptSettings(settings: ScriptSettings): string {
  const clean = parseScriptSettings(settings);
  const same =
    TITLE_PAGE_FIELDS.every((f) => clean.titlePage[f] === "") &&
    clean.showTitlePage === DEFAULT_SCRIPT_SETTINGS.showTitlePage &&
    clean.more === DEFAULT_SCRIPT_SETTINGS.more &&
    clean.contd === DEFAULT_SCRIPT_SETTINGS.contd &&
    clean.sceneNumbers === DEFAULT_SCRIPT_SETTINGS.sceneNumbers;
  return same ? "" : JSON.stringify(clean);
}

/** The page options the engine takes, from the settings. */
export function pageOptionsOf(settings: Pick<ScriptSettings, "more" | "contd" | "sceneNumbers">): Required<PageOptions> {
  return { more: settings.more, contd: settings.contd, sceneNumbers: settings.sceneNumbers };
}

/** The title page as it is set: a blank title is the manuscript's, a blank author is the manuscript's, and "Written by" stands in for an author's credit. */
export function resolveTitlePage(page: TitlePage, fallback: { title: string; author: string }): TitlePage {
  const author = page.author.trim() || fallback.author.trim();
  return {
    ...page,
    title: page.title.trim() || fallback.title.trim(),
    author,
    credit: page.credit.trim() || (author ? "Written by" : ""),
  };
}

/** Whether a title page says anything at all. */
export function hasTitlePageText(page: TitlePage): boolean {
  return TITLE_PAGE_FIELDS.some((f) => page[f].trim() !== "");
}

/** Everything a title page says, joined, for the language check. */
export function titlePageText(page: TitlePage): string {
  return TITLE_PAGE_FIELDS.map((f) => page[f]).join("\n");
}

/**
 * Whether the screenplay PDF can set a script and its title page: the sequences
 * (`scriptHtmlSupported`) and, when the title page is shown, its words as the
 * PDF sets them (blanks filled from the manuscript's title and author). The
 * server, the web menu and the phone all ask this one question.
 */
export function scriptPdfSupported(
  chapters: readonly string[],
  settings: Pick<ScriptSettings, "titlePage" | "showTitlePage">,
  manuscript: { title: string; author: string }
): boolean {
  return scriptHtmlSupported(
    chapters,
    settings.showTitlePage ? titlePageText(resolveTitlePage(settings.titlePage, manuscript)) : ""
  );
}
