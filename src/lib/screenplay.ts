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
};

export const SCREENPLAY_ATTR = "data-sp";

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
};

/** The element a new block takes when Enter splits or ends `current`. */
export function nextElementOnEnter(current: ScreenplayElement): ScreenplayElement {
  return AFTER_ENTER[current];
}

/**
 * The element shortcuts, in the order of the digits that choose them: Alt+Shift
 * plus 1 to 7. Never Cmd/Ctrl+digit: browsers keep those for switching tabs,
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
];

/** The digit (1 to 7) that chooses `element` with Alt+Shift. */
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
    const bare = attrs.replace(/\s*\bdata-sp\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    return tag === "action" ? `<${name}${bare}>` : `<${name}${bare} ${SCREENPLAY_ATTR}="${tag}">`;
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
  align: "left" | "right";
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
};

/** Elements that stay on the page with the block after them. */
const KEEP_WITH_NEXT: ReadonlySet<ScreenplayElement> = new Set([
  "scene-heading",
  "shot",
  "character",
  "parenthetical",
]);

/** Elements a page may break in the middle of, with two lines left on each side. */
const SPLITTABLE: ReadonlySet<ScreenplayElement> = new Set(["action", "dialogue"]);

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
export type ScriptBlock = { element: string; text: string };

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
  align: "left" | "right";
  bold: boolean;
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
 * longer than the measure where it overflows. `\n` starts a new line.
 */
export function wrapText(text: string, width: number): LaidOutLine[] {
  const out: LaidOutLine[] = [];
  let hardStart = 0;
  for (;;) {
    const hardEnd = text.indexOf("\n", hardStart);
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

/** Set one block on the page: its lines, indent, and the blank lines above it. */
export function layoutBlock(block: ScriptBlock, above: ScreenplayElement | null, index = 0): LaidOutBlock {
  const element = normalizeElement(block.element);
  const metrics = ELEMENT_METRICS[element];
  let text = block.text;
  let prefix = 0;
  if (element === "parenthetical") {
    text = `(${text})`;
    prefix = 1;
  } else if (metrics.caps) {
    text = upper(text);
  }
  const lines = wrapText(text, metrics.width).map((line) => ({
    text: line.text,
    start: Math.max(0, line.start - prefix),
  }));
  return {
    index,
    element,
    before: blankLinesBefore(element, above),
    lines,
    indent: metrics.indent,
    width: metrics.width,
    align: metrics.align,
    bold: metrics.bold,
  };
}

/** Set a run of blocks on the page. */
export function layout(blocks: readonly ScriptBlock[]): LaidOutBlock[] {
  const out: LaidOutBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    out.push(layoutBlock(blocks[i], i === 0 ? null : out[i - 1].element, i));
  }
  return out;
}

// --- Pagination --------------------------------------------------------------

/** Where the next line goes: `line` lines of `page` are used. A fresh script is page 1, line 0. */
export type PageCursor = { page: number; line: number };

export const SCRIPT_START: PageCursor = { page: 1, line: 0 };

/** A page begins here: `line` lines into block `block` (0: just before it). */
export type PageBreak = {
  /** The page that begins. */
  page: number;
  block: number;
  line: number;
  /** The character offset in the block's text of that line. */
  offset: number;
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

/** Lines of block `i` that must share a page with its start, with the chain of blocks it keeps with. */
function startNeed(laid: readonly LaidOutBlock[], i: number): number {
  let need = 0;
  for (let j = i; j < laid.length; j++) {
    const b = laid[j];
    const n = b.lines.length;
    if (KEEP_WITH_NEXT.has(b.element) && j + 1 < laid.length) {
      need += b.before + n;
      if (need > PAGE_LINES) return need;
      continue;
    }
    return need + b.before + (SPLITTABLE.has(b.element) ? Math.min(n, 2) : n);
  }
  return need;
}

/**
 * Break laid-out blocks into pages. A scene heading, shot, cue, or parenthetical
 * stays with what follows; an action or speech breaks across a page only with
 * two lines on each side; anything else moves whole. An estimate: no (MORE) and
 * (CONT'D), and the real page rule is "roughly, sometimes" a minute.
 */
export function paginate(laid: readonly LaidOutBlock[], opts: { start?: PageCursor } = {}): Pagination {
  const breaks: PageBreak[] = [];
  let page = opts.start?.page ?? 1;
  let line = opts.start?.line ?? 0;

  for (let i = 0; i < laid.length; i++) {
    const b = laid[i];
    const total = b.lines.length;
    const newPage = (at: number) => {
      page++;
      line = 0;
      breaks.push({ page, block: i, line: at, offset: at === 0 ? 0 : b.lines[at].start });
    };

    const need = startNeed(laid, i);
    if (line > 0 && line + need > PAGE_LINES && need <= PAGE_LINES) newPage(0);
    if (line > 0) line += b.before;

    let placed = 0;
    while (placed < total) {
      const room = PAGE_LINES - line;
      const left = total - placed;
      if (left <= room) {
        line += left;
        break;
      }
      let take = 0;
      if (SPLITTABLE.has(b.element)) {
        take = Math.min(room, left - 2);
        if (placed === 0 && take < 2) take = 0;
      }
      if (take <= 0) {
        if (line > 0) {
          newPage(placed);
          continue;
        }
        take = room; // Taller than a page and not one to split: it has to.
      }
      line += take;
      placed += take;
      newPage(placed);
    }
  }

  const end = { page, line };
  return { breaks, end, pages: pagesAt(end) };
}

/** One row of a typeset page; null is a blank line. */
export type PageRow = {
  text: string;
  indent: number;
  width: number;
  align: "left" | "right";
  bold: boolean;
  block: number;
} | null;

/**
 * The pages themselves, line by line: what the PDF writer draws and what a
 * golden fixture pins. Starts at a fresh page.
 */
export function typeset(blocks: readonly ScriptBlock[]): { pages: PageRow[][]; pagination: Pagination } {
  const laid = layout(blocks);
  const pagination = paginate(laid);
  const pages: PageRow[][] = [[]];
  let next = 0;
  for (const b of laid) {
    let lineAt = 0;
    while (lineAt < b.lines.length) {
      const brk = pagination.breaks[next];
      if (brk && brk.block === b.index && brk.line === lineAt) {
        pages.push([]);
        next++;
      }
      const page = pages[pages.length - 1];
      if (lineAt === 0 && page.length > 0) for (let k = 0; k < b.before; k++) page.push(null);
      const l = b.lines[lineAt];
      page.push({
        text: l.text,
        indent: b.indent,
        width: b.width,
        align: b.align,
        bold: b.bold,
        block: b.index,
      });
      lineAt++;
    }
  }
  return { pages: pages.filter((p) => p.length > 0), pagination };
}

/** A typeset script as plain text, one string per page, for fixtures and debugging. */
export function pagesAsText(pages: readonly PageRow[][]): string[] {
  return pages.map((page) =>
    page
      .map((row) => {
        if (!row) return "";
        const pad = row.align === "right" ? row.indent + row.width - row.text.length : row.indent;
        return " ".repeat(Math.max(0, pad)) + row.text;
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

/**
 * A chapter's block HTML as script blocks: the element off each paragraph,
 * `<br>` as a line break, tags dropped, entities decoded. A heading, quote, or
 * list item (what StarterKit's input rules can still make) sets as action.
 */
export function scriptBlocksFromHtml(html: string): ScriptBlock[] {
  const out: ScriptBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(html))) {
    const inner = m[3].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "");
    out.push({
      element: m[1].toLowerCase() === "p" ? elementTagOfHtml(m[0]) : "action",
      text: decodeEntities(inner),
    });
  }
  return out;
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
export function sequenceCursors(chapters: readonly string[]): { starts: PageCursor[]; end: PageCursor } {
  layoutCacheMax = Math.max(layoutCacheMax, chapters.length + LAYOUT_CACHE_MIN);
  const starts: PageCursor[] = [];
  let cursor: PageCursor = SCRIPT_START;
  for (const html of chapters) {
    starts.push(cursor);
    cursor = paginate(layoutHtml(html), { start: cursor }).end;
  }
  return { starts, end: cursor };
}

/** About how many pages a script runs, from its sequences' HTML in order. 0 for an empty one. */
export function estimatePages(chapters: readonly string[]): number {
  return pagesAt(sequenceCursors(chapters).end);
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
