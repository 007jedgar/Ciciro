// Find and replace inside a manuscript's block HTML.
//
// A block's visible text is spread across text nodes split by inline marks
// (`ma<em>rk</em>ed`), so matching runs on the concatenated text and a
// replacement is written back into the nodes it touched: the first node takes
// the replacement, later nodes only lose the matched characters. Marks and
// attributes outside the match are never rewritten, and a node no match
// touches keeps its exact bytes.

export type SearchOptions = {
  matchCase: boolean;
  wholeWord: boolean;
};

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = { matchCase: false, wholeWord: false };

export const MAX_QUERY_LENGTH = 200;

/** A match inside one block, as offsets into that block's visible text. */
export type BlockMatch = { start: number; end: number };

type Part = { tag: boolean; raw: string; text: string };
type Cell = { part: number; index: number } | null;

const TAG_OR_TEXT = /<[^>]*>|[^<]+/g;
const BR = /^<\s*br\b/i;
const BLOCK_TAG = /^<\s*\/?\s*(p|li|ul|ol|blockquote|h[1-6]|pre|div)\b/i;
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

function encodeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u00a0/g, "&nbsp;");
}

type Flat = { parts: Part[]; text: string; cells: Cell[]; boundaries: Set<number> };

/**
 * The visible text of a block plus, per character, the text node it came from.
 * `boundaries` are the offsets where one paragraph inside the block (a quote's
 * or list item's) ends and the next begins; they add no character.
 */
function flatten(html: string): Flat {
  const parts: Part[] = [];
  const cells: Cell[] = [];
  const boundaries = new Set<number>();
  let text = "";
  TAG_OR_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_OR_TEXT.exec(html))) {
    const raw = m[0];
    if (raw[0] === "<") {
      parts.push({ tag: true, raw, text: "" });
      // A hard break is visible as a line break; no match may span it.
      if (BR.test(raw)) {
        text += "\n";
        cells.push(null);
      } else if (BLOCK_TAG.test(raw)) {
        boundaries.add(text.length);
      }
      continue;
    }
    const decoded = decodeEntities(raw);
    const part = parts.length;
    parts.push({ tag: false, raw, text: decoded });
    for (let i = 0; i < decoded.length; i++) cells.push({ part, index: i });
    text += decoded;
  }
  return { parts, text, cells, boundaries };
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && ch !== "" && WORD_CHAR.test(ch);
}

/** The search query is one line; anything else cannot match a paragraph. */
export function normalizeQuery(query: string): string | null {
  if (!query || /[\r\n]/.test(query) || query.length > MAX_QUERY_LENGTH) return null;
  return query;
}

// Case folding that never changes a string's length, so offsets in the folded
// text are offsets in the original (`"İ".toLowerCase()` is two code units).
function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

// A non-breaking space matches a typed space, one code unit for one.
function spaces(s: string): string {
  return s.replace(/\u00a0/g, " ");
}

/** `boundaries` are paragraph breaks no match may cross; each counts as a non-word neighbour. */
export function findMatches(
  text: string,
  query: string,
  options: SearchOptions,
  boundaries: ReadonlySet<number> = new Set()
): BlockMatch[] {
  const needle = normalizeQuery(query);
  if (!needle || !text) return [];
  const haystack = spaces(options.matchCase ? text : fold(text));
  const target = spaces(options.matchCase ? needle : fold(needle));
  const wordStart = isWordChar(target[0]);
  const wordEnd = isWordChar(target[target.length - 1]);
  const found: BlockMatch[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(target, from);
    if (at < 0) break;
    const end = at + target.length;
    let crosses = false;
    for (let b = at + 1; b < end && !crosses; b++) crosses = boundaries.has(b);
    const ok =
      !crosses &&
      (!options.wholeWord ||
        ((!wordStart || boundaries.has(at) || !isWordChar(text[at - 1])) &&
          (!wordEnd || boundaries.has(end) || !isWordChar(text[end]))));
    if (ok) {
      found.push({ start: at, end });
      from = end;
    } else {
      from = at + 1;
    }
  }
  return found;
}

/** Matches in a block's HTML, with the text the offsets index into. */
export function searchBlockHtml(
  html: string,
  query: string,
  options: SearchOptions
): { text: string; matches: BlockMatch[]; boundaries: ReadonlySet<number> } {
  const { text, boundaries } = flatten(html);
  return { text, matches: findMatches(text, query, options, boundaries), boundaries };
}

/** One match addressed by its index among the block's matches and its start offset. */
export type OccurrenceTarget = { occurrence: number; offset: number };

/**
 * Replace matches in a block's HTML. `only` limits it to one occurrence, which
 * must still start at the offset the search reported; without it every match
 * is replaced. An occurrence that does not exist or has moved is `count: 0`
 * with the html untouched.
 */
export function replaceInBlockHtml(
  html: string,
  query: string,
  replacement: string,
  options: SearchOptions,
  only?: OccurrenceTarget
): { html: string; count: number } {
  const flat = flatten(html);
  let matches = findMatches(flat.text, query, options, flat.boundaries);
  if (only !== undefined) {
    const hit = matches[only.occurrence];
    matches = hit && hit.start === only.offset ? [hit] : [];
  }
  if (matches.length === 0) return { html, count: 0 };

  const decoded = flat.parts.map((p) => p.text);
  const touched = new Set<number>();
  // Back to front: an edit only shifts characters after it, so the offsets of
  // matches still to be applied stay valid.
  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end } = matches[i];
    const spans = new Map<number, { lo: number; hi: number }>();
    for (let at = start; at < end; at++) {
      const cell = flat.cells[at];
      if (!cell) continue;
      const span = spans.get(cell.part);
      if (span) span.hi = cell.index;
      else spans.set(cell.part, { lo: cell.index, hi: cell.index });
    }
    const firstPart = flat.cells[start]?.part;
    for (const [part, { lo, hi }] of spans) {
      touched.add(part);
      decoded[part] =
        decoded[part].slice(0, lo) + (part === firstPart ? replacement : "") + decoded[part].slice(hi + 1);
    }
  }

  const out = flat.parts
    .map((p, i) => (p.tag || !touched.has(i) ? p.raw : encodeText(decoded[i])))
    .join("");
  return { html: out, count: matches.length };
}

const SNIPPET_CONTEXT = 48;

/**
 * A trimmed slice of the block's text on each side of a match, for display.
 * `boundaries` (paragraph breaks inside the block) show as a space, since the
 * flattened text has no character there.
 */
export function snippetAround(
  text: string,
  match: BlockMatch,
  context = SNIPPET_CONTEXT,
  boundaries: ReadonlySet<number> = new Set()
): { before: string; match: string; after: string } {
  const slice = (lo: number, hi: number) => {
    let out = "";
    for (let at = lo; at < hi; at++) out += (at > lo && boundaries.has(at) ? " " : "") + text[at];
    return out.replace(/\s+/g, " ");
  };
  const from = Math.max(0, match.start - context);
  const to = Math.min(text.length, match.end + context);
  return {
    before: (from > 0 ? "…" : "") + slice(from, match.start) + (match.start > from && boundaries.has(match.start) ? " " : ""),
    match: slice(match.start, match.end),
    after: (to > match.end && boundaries.has(match.end) ? " " : "") + slice(match.end, to) + (to < text.length ? "…" : ""),
  };
}
