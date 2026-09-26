// Tracked changes: suggested insertions and deletions that live inline in a
// chapter's HTML until the author accepts or rejects them.
//
// Must stay byte-for-byte identical to apps/mobile/lib/suggestions.ts. The
// Next app and the Expo app cannot share a build, so the parity test compares
// the two files. If it fails, fix the file, not the test.
//
// A suggestion is every <ins>/<del> element that shares one
// data-suggestion-id, stamped with who proposed it and when:
//
//   <p data-block-id="b1">She <del data-suggestion-id="sg-1" data-author-id="ciciro"
//   data-author-name="Ciciro" data-created-at="...">walked slowly</del><ins
//   data-suggestion-id="sg-1" ...>ambled</ins> to the door.</p>
//
// Keeping the marks inside the block HTML is what lets a suggestion ride every
// existing write and sync path: ops carry whole blocks, so the desk, the
// server, and the phone's replica all hold the same pending change without a
// table of their own.
//
// Anchoring. A pending change is addressed as (blockId, suggestionId): the
// block id is the durable paragraph id every replica already agrees on, and
// the inline mark id pins the exact run of text inside it. Anything else that
// needs to hang off a span of prose (a reader's comment, say) can use the same
// pair with its own inline mark; the parser below keeps unknown inline
// elements intact, so another mark survives every rewrite done here.
//
// "Pending" means not yet applied: word counts and exports read the chapter
// through htmlWithoutSuggestions, which keeps deleted text and drops inserted
// text, exactly as if every suggestion were rejected.

export type SuggestionKind = "insert" | "delete";

export type SuggestionAuthor = {
  authorId: string;
  authorName: string;
};

export type SuggestionMark = SuggestionAuthor & {
  kind: SuggestionKind;
  id: string;
  createdAt: string;
};

export type SuggestionAction = "accept" | "reject";

/** The editor (Ciciro) as a suggestion author. */
export const CICIRO_AUTHOR: SuggestionAuthor = { authorId: "ciciro", authorName: "Ciciro" };

/** Attribute names, in the order every writer renders them. */
export const SUGGESTION_ATTRS = {
  id: "data-suggestion-id",
  authorId: "data-author-id",
  authorName: "data-author-name",
  createdAt: "data-created-at",
} as const;

let fallbackSeq = 0;

/** A short id for a new suggestion. Hermes has no `crypto`, so fall back. */
export function newSuggestionId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = c?.randomUUID?.();
  if (uuid) return `sg-${uuid.replace(/-/g, "").slice(0, 12)}`;
  fallbackSeq += 1;
  return `sg-${Date.now().toString(36)}${fallbackSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Inline model
// ---------------------------------------------------------------------------

const FMT_BOLD = 1;
const FMT_CODE = 2;
const FMT_ITALIC = 4;
const FMT_STRIKE = 8;
const FMT_UNDERLINE = 16;

// Outer to inner, the same order TipTap's schema ranks these marks, so a block
// rewritten here serializes the way the desk editor would.
const FMT_TAGS: ReadonlyArray<readonly [number, string]> = [
  [FMT_BOLD, "strong"],
  [FMT_CODE, "code"],
  [FMT_ITALIC, "em"],
  [FMT_STRIKE, "s"],
  [FMT_UNDERLINE, "u"],
];

const FMT_BY_TAG: Record<string, number> = {
  strong: FMT_BOLD,
  b: FMT_BOLD,
  code: FMT_CODE,
  em: FMT_ITALIC,
  i: FMT_ITALIC,
  s: FMT_STRIKE,
  strike: FMT_STRIKE,
  del: FMT_STRIKE,
  u: FMT_UNDERLINE,
};

// Nested block structure inside a block (TipTap's <blockquote><p>...) is kept
// as fixed tags that text edits never cross.
const STRUCT_TAGS = new Set([
  "p",
  "div",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "section",
  "article",
  "header",
  "footer",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "hr",
]);

const VOID_TAGS = new Set(["img", "wbr", "input", "source", "area", "col", "embed", "track"]);

type TextItem = {
  t: "text";
  /** One code point, "\n" for a <br>, U+FFFC for another inline void. */
  ch: string;
  /** Verbatim HTML for atoms (<br>, <img>, an entity we do not decode). */
  raw: string | null;
  fmt: number;
  /** Opening tags of other inline elements (spans, links, anchors), outer first. */
  wraps: string[];
  sugg: SuggestionMark | null;
};

type TagItem = { t: "tag"; raw: string };

type Item = TextItem | TagItem;

type OpenEntry =
  | { name: string; kind: "fmt"; bit: number }
  | { name: string; kind: "sugg"; mark: SuggestionMark }
  | { name: string; kind: "wrap"; raw: string };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
};

function decodeEntity(entity: string): string | null {
  const body = entity.slice(1, -1);
  if (body.startsWith("#x") || body.startsWith("#X")) {
    const code = parseInt(body.slice(2), 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
  }
  if (body.startsWith("#")) {
    const code = parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
  }
  return NAMED_ENTITIES[body] ?? null;
}

function decodeAttr(value: string): string {
  return value.replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (e) => decodeEntity(e) ?? e);
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/\u00a0/g, "&nbsp;");
}

/** Index of the `>` that closes the tag opening at `from`, honoring quotes. */
function tagEnd(html: string, from: number): number {
  let quote = "";
  for (let i = from + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}

function readAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = tag.replace(/^<\s*[a-zA-Z][\w:-]*/, "").replace(/\/?\s*>$/, "");
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    attrs[m[1].toLowerCase()] = decodeAttr(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function suggestionFromTag(kind: SuggestionKind, tag: string): SuggestionMark | null {
  const attrs = readAttrs(tag);
  const id = attrs[SUGGESTION_ATTRS.id];
  if (!id) return null;
  return {
    kind,
    id,
    authorId: attrs[SUGGESTION_ATTRS.authorId] ?? "",
    authorName: attrs[SUGGESTION_ATTRS.authorName] ?? "",
    createdAt: attrs[SUGGESTION_ATTRS.createdAt] ?? "",
  };
}

function suggestionOpenTag(mark: SuggestionMark): string {
  const tag = mark.kind === "insert" ? "ins" : "del";
  return (
    `<${tag} ${SUGGESTION_ATTRS.id}="${escapeAttr(mark.id)}"` +
    ` ${SUGGESTION_ATTRS.authorId}="${escapeAttr(mark.authorId)}"` +
    ` ${SUGGESTION_ATTRS.authorName}="${escapeAttr(mark.authorName)}"` +
    ` ${SUGGESTION_ATTRS.createdAt}="${escapeAttr(mark.createdAt)}">`
  );
}

function suggestionKey(mark: SuggestionMark | null): string {
  if (!mark) return "";
  return `${mark.kind}\u0000${mark.id}\u0000${mark.authorId}\u0000${mark.authorName}\u0000${mark.createdAt}`;
}

function tagName(raw: string): string {
  return (raw.match(/^<\s*\/?\s*([a-zA-Z][\w:-]*)/)?.[1] ?? "span").toLowerCase();
}

function parseInline(inner: string): Item[] {
  const items: Item[] = [];
  const stack: OpenEntry[] = [];
  let fmt = 0;
  let wraps: string[] = [];
  let sugg: SuggestionMark | null = null;

  const restate = () => {
    fmt = 0;
    wraps = [];
    sugg = null;
    for (const entry of stack) {
      if (entry.kind === "fmt") fmt |= entry.bit;
      else if (entry.kind === "wrap") wraps.push(entry.raw);
      else sugg = entry.mark;
    }
  };

  const pushChar = (ch: string, raw: string | null) => {
    items.push({ t: "text", ch, raw, fmt, wraps, sugg });
  };

  const pushText = (text: string) => {
    let i = 0;
    while (i < text.length) {
      if (text[i] === "&") {
        const m = /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.exec(text.slice(i, i + 12));
        if (m) {
          const decoded = decodeEntity(m[0]);
          if (decoded === null) pushChar(m[0], m[0]);
          else for (const ch of decoded) pushChar(ch, null);
          i += m[0].length;
          continue;
        }
      }
      const cp = text.codePointAt(i) ?? 0;
      const ch = String.fromCodePoint(cp);
      // A literal newline in HTML text is whitespace, not a line break.
      pushChar(ch === "\n" || ch === "\r" || ch === "\t" ? " " : ch, null);
      i += ch.length;
    }
  };

  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf("<", i);
    const textEnd = lt === -1 ? inner.length : lt;
    if (textEnd > i) {
      pushText(inner.slice(i, textEnd));
      i = textEnd;
      continue;
    }
    if (inner.startsWith("<!--", i)) {
      const end = inner.indexOf("-->", i + 4);
      i = end === -1 ? inner.length : end + 3;
      continue;
    }
    const gt = tagEnd(inner, i);
    const head = /^<\s*(\/?)\s*([a-zA-Z][\w:-]*)/.exec(inner.slice(i, i + 64));
    if (gt === -1 || !head) {
      pushText(inner[i]);
      i += 1;
      continue;
    }
    const raw = inner.slice(i, gt + 1);
    i = gt + 1;
    const closing = head[1] === "/";
    const name = head[2].toLowerCase();
    if (closing) {
      if (STRUCT_TAGS.has(name)) {
        items.push({ t: "tag", raw });
        continue;
      }
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === name) {
          stack.splice(s, 1);
          restate();
          break;
        }
      }
      continue;
    }
    if (name === "br") {
      pushChar("\n", raw);
      continue;
    }
    if (STRUCT_TAGS.has(name)) {
      items.push({ t: "tag", raw });
      continue;
    }
    if (VOID_TAGS.has(name) || /\/\s*>$/.test(raw)) {
      pushChar("\ufffc", raw);
      continue;
    }
    if (name === "ins" || name === "del") {
      const mark = suggestionFromTag(name === "ins" ? "insert" : "delete", raw);
      if (mark) {
        stack.push({ name, kind: "sugg", mark });
        restate();
        continue;
      }
    }
    const bit = FMT_BY_TAG[name];
    if (bit) stack.push({ name, kind: "fmt", bit });
    else stack.push({ name, kind: "wrap", raw });
    restate();
  }
  return items;
}

type OpenMark = { key: string; open: string; close: string };

function marksOf(item: TextItem): OpenMark[] {
  const marks: OpenMark[] = [];
  if (item.sugg) {
    marks.push({
      key: suggestionKey(item.sugg),
      open: suggestionOpenTag(item.sugg),
      close: item.sugg.kind === "insert" ? "</ins>" : "</del>",
    });
  }
  for (const [bit, tag] of FMT_TAGS) {
    if (item.fmt & bit) marks.push({ key: tag, open: `<${tag}>`, close: `</${tag}>` });
  }
  for (const raw of item.wraps) marks.push({ key: raw, open: raw, close: `</${tagName(raw)}>` });
  return marks;
}

function serializeInline(items: readonly Item[]): string {
  let out = "";
  let open: OpenMark[] = [];
  const closeFrom = (keep: number) => {
    for (let i = open.length - 1; i >= keep; i--) out += open[i].close;
    open = open.slice(0, keep);
  };
  for (const item of items) {
    if (item.t === "tag") {
      closeFrom(0);
      out += item.raw;
      continue;
    }
    const want = marksOf(item);
    let keep = 0;
    while (keep < open.length && keep < want.length && open[keep].key === want[keep].key) keep++;
    closeFrom(keep);
    for (let i = keep; i < want.length; i++) out += want[i].open;
    open = want;
    out += item.raw ?? escapeText(item.ch);
  }
  closeFrom(0);
  return out;
}

function sameItem(a: Item, b: Item): boolean {
  if (a.t === "tag" || b.t === "tag") return a.t === b.t && a.raw === b.raw;
  return (
    a.ch === b.ch &&
    a.raw === b.raw &&
    a.fmt === b.fmt &&
    a.wraps.join("") === b.wraps.join("") &&
    suggestionKey(a.sugg) === suggestionKey(b.sugg)
  );
}

function sameItems(a: readonly Item[], b: readonly Item[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameItem(a[i], b[i])) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

// Same block grammar as manuscript.ts, so a block here is a block there.
const BLOCK_RE = /<(p|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>|<hr\b[^>]*\/?>/gi;

type Block = {
  start: number;
  end: number;
  html: string;
  id: string | null;
  open: string;
  close: string;
  /** Null for a scene break (<hr>), which holds no text. */
  items: Item[] | null;
};

function scanBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(html))) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const openEnd = tagEnd(raw, 0);
    const open = raw.slice(0, openEnd + 1);
    const id = readAttrs(open)["data-block-id"] || null;
    if (/^<hr\b/i.test(raw)) {
      blocks.push({ start, end, html: raw, id, open: raw, close: "", items: null });
      continue;
    }
    const close = `</${m[1]}>`;
    const inner = raw.slice(open.length, raw.length - close.length);
    blocks.push({ start, end, html: raw, id, open, close, items: parseInline(inner) });
  }
  return blocks;
}

function blockHtml(block: Block, items: readonly Item[]): string {
  return block.open + serializeInline(items) + block.close;
}

/** Rebuild the chapter, swapping in (or dropping, with null) changed blocks. */
function spliceBlocks(html: string, blocks: readonly Block[], next: Map<Block, string | null>): string {
  if (next.size === 0) return html;
  let out = "";
  let at = 0;
  for (const block of blocks) {
    if (!next.has(block)) continue;
    out += html.slice(at, block.start);
    out += next.get(block) ?? "";
    at = block.end;
  }
  return out + html.slice(at);
}

const SUGGESTION_TAG_RE = /<(?:ins|del)\b[^>]*\bdata-suggestion-id\s*=/i;

/** True when the HTML carries at least one pending suggestion. */
export function hasSuggestions(html: string): boolean {
  return SUGGESTION_TAG_RE.test(html);
}

function isText(item: Item): item is TextItem {
  return item.t === "text";
}

function visible(item: Item): boolean {
  return item.t === "text" && item.ch.trim() !== "";
}

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

/**
 * Accept or reject pending suggestions: every one when `ids` is omitted, else
 * just those. Accepting drops deleted text and keeps inserted text; rejecting
 * does the reverse. A paragraph left with no words (a whole-paragraph deletion
 * accepted, a whole-paragraph insertion rejected) is removed rather than left
 * behind as an empty line. Blocks without a matching suggestion come back
 * byte-for-byte.
 */
export function resolveSuggestions(
  html: string,
  action: SuggestionAction,
  ids?: readonly string[] | null
): string {
  if (!hasSuggestions(html)) return html;
  const wanted = ids ? new Set(ids) : null;
  const drop: SuggestionKind = action === "accept" ? "delete" : "insert";
  const blocks = scanBlocks(html);
  const next = new Map<Block, string | null>();
  const dropped: Block[] = [];
  let kept = 0;
  for (const block of blocks) {
    const items = block.items;
    if (!items) {
      kept += 1;
      continue;
    }
    let touched = false;
    let removed = false;
    const out: Item[] = [];
    for (const item of items) {
      if (item.t === "text" && item.sugg && (!wanted || wanted.has(item.sugg.id))) {
        touched = true;
        if (item.sugg.kind === drop) {
          removed = true;
          continue;
        }
        out.push({ ...item, sugg: null });
        continue;
      }
      out.push(item);
    }
    if (!touched) {
      kept += 1;
      continue;
    }
    if (removed && items.some(visible) && !out.some(visible)) {
      next.set(block, null);
      dropped.push(block);
      continue;
    }
    kept += 1;
    next.set(block, blockHtml(block, out));
  }
  // A chapter always keeps at least one paragraph to type into.
  if (kept === 0 && dropped.length > 0) next.set(dropped[0], blockHtml(dropped[0], []));
  return spliceBlocks(html, blocks, next);
}

/** The chapter as it stands with every pending suggestion still unapplied. */
export function htmlWithoutSuggestions(html: string): string {
  return resolveSuggestions(html, "reject");
}

/** The chapter as it would read with every pending suggestion accepted. */
export function htmlWithSuggestionsApplied(html: string): string {
  return resolveSuggestions(html, "accept");
}

/**
 * Pending suggestions spelled out in the text itself, wdiff style:
 * "She [-walked slowly-]{+ambled+} home." For readers with no markup, like
 * the model, who must see both what stands and what is proposed.
 */
export function suggestionsAsTextMarkers(html: string): string {
  if (!hasSuggestions(html)) return html;
  const blocks = scanBlocks(html);
  const next = new Map<Block, string | null>();
  for (const block of blocks) {
    const items = block.items;
    if (!items || !items.some((it) => it.t === "text" && it.sugg)) continue;
    const out: Item[] = [];
    let open: SuggestionMark | null = null;
    const marker = (text: string, like: TextItem) => {
      for (const ch of text) out.push({ ...like, ch, raw: null, sugg: null });
    };
    const close = (like: TextItem) => {
      if (open) marker(open.kind === "insert" ? "+}" : "-]", like);
      open = null;
    };
    items.forEach((item, i) => {
      if (item.t === "tag") {
        const prev = out[out.length - 1];
        if (prev?.t === "text") close(prev);
        out.push(item);
        return;
      }
      if (suggestionKey(item.sugg) !== suggestionKey(open)) {
        close(item);
        if (item.sugg) {
          marker(item.sugg.kind === "insert" ? "{+" : "[-", item);
          open = item.sugg;
        }
      }
      out.push({ ...item, sugg: null });
      if (i === items.length - 1) close(item);
    });
    next.set(block, blockHtml(block, out));
  }
  return spliceBlocks(html, blocks, next);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type SuggestionPiece = { kind: "context" | "insert" | "delete"; text: string };

export type SuggestionSummary = SuggestionAuthor & {
  id: string;
  createdAt: string;
  blockIds: string[];
  /** Text this suggestion adds when accepted. */
  inserted: string;
  /** Text this suggestion removes when accepted. */
  deleted: string;
  /** The change with a little surrounding prose, for a review card. */
  preview: SuggestionPiece[];
};

const CONTEXT_CHARS = 48;

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function leadingContext(items: readonly Item[]): string {
  const text = flat(items.filter((it): it is TextItem => isText(it) && it.sugg?.kind !== "insert").map((it) => it.ch).join(""));
  if (text.length <= CONTEXT_CHARS) return text;
  const cut = text.slice(-CONTEXT_CHARS);
  const space = cut.indexOf(" ");
  return `\u2026${space >= 0 && space < CONTEXT_CHARS - 8 ? cut.slice(space) : cut}`;
}

function trailingContext(items: readonly Item[]): string {
  const text = flat(items.filter((it): it is TextItem => isText(it) && it.sugg?.kind !== "insert").map((it) => it.ch).join(""));
  if (text.length <= CONTEXT_CHARS) return text;
  const cut = text.slice(0, CONTEXT_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${space > 8 ? cut.slice(0, space) : cut}\u2026`;
}

function pushPiece(pieces: SuggestionPiece[], kind: SuggestionPiece["kind"], text: string) {
  if (!text) return;
  const last = pieces[pieces.length - 1];
  if (last && last.kind === kind) last.text += text;
  else pieces.push({ kind, text });
}

/** Every pending suggestion in document order, ready for a review list. */
export function listSuggestions(html: string): SuggestionSummary[] {
  if (!hasSuggestions(html)) return [];
  const blocks = scanBlocks(html);
  const order: string[] = [];
  const where = new Map<string, { mark: SuggestionMark; spots: Array<{ block: number; first: number; last: number }> }>();
  blocks.forEach((block, b) => {
    block.items?.forEach((item, i) => {
      if (item.t !== "text" || !item.sugg) return;
      let entry = where.get(item.sugg.id);
      if (!entry) {
        entry = { mark: item.sugg, spots: [] };
        where.set(item.sugg.id, entry);
        order.push(item.sugg.id);
      }
      const spot = entry.spots[entry.spots.length - 1];
      if (spot && spot.block === b) spot.last = i;
      else entry.spots.push({ block: b, first: i, last: i });
    });
  });

  return order.map((id) => {
    const { mark, spots } = where.get(id)!;
    const preview: SuggestionPiece[] = [];
    let inserted = "";
    let deleted = "";
    spots.forEach((spot, s) => {
      const items = blocks[spot.block].items ?? [];
      if (s === 0) pushPiece(preview, "context", leadingContext(items.slice(0, spot.first)));
      else {
        pushPiece(preview, "context", " \u00b6 ");
        inserted += inserted ? " " : "";
        deleted += deleted ? " " : "";
      }
      for (let i = spot.first; i <= spot.last; i++) {
        const item = items[i];
        if (item.t !== "text") continue;
        const ch = item.ch === "\n" ? " " : item.ch;
        if (item.sugg?.id === id) {
          pushPiece(preview, item.sugg.kind, ch);
          if (item.sugg.kind === "insert") inserted += ch;
          else deleted += ch;
        } else if (item.sugg?.kind !== "insert") {
          pushPiece(preview, "context", ch);
        }
      }
      if (s === spots.length - 1) pushPiece(preview, "context", trailingContext(items.slice(spot.last + 1)));
    });
    return {
      id,
      authorId: mark.authorId,
      authorName: mark.authorName,
      createdAt: mark.createdAt,
      blockIds: spots.map((spot) => blocks[spot.block].id ?? "").filter(Boolean),
      inserted: flat(inserted).trim(),
      deleted: flat(deleted).trim(),
      preview: preview.map((piece) => ({ ...piece, text: flat(piece.text) })),
    };
  });
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

type EditOp = "=" | "-" | "+";

/**
 * Myers' shortest edit script between two sequences, trimmed of a common
 * prefix and suffix first. When the middle needs more than `maxD` edits it is
 * treated as one wholesale replacement, which is always correct, just coarse.
 */
function diffSequences<T>(a: readonly T[], b: readonly T[], maxD: number): EditOp[] {
  return trimmedDiff(a, b, maxD).ops;
}

/** diffSequences, also saying whether the middle fit the budget (`exact`). */
function trimmedDiff<T>(a: readonly T[], b: readonly T[], maxD: number): { ops: EditOp[]; exact: boolean } {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  const exact = myers(midA, midB, maxD);
  const core = exact ?? [...midA.map((): EditOp => "-"), ...midB.map((): EditOp => "+")];
  const ops: EditOp[] = [];
  for (let i = 0; i < pre; i++) ops.push("=");
  ops.push(...core);
  for (let i = 0; i < suf; i++) ops.push("=");
  return { ops, exact: exact !== null };
}

function myers<T>(a: readonly T[], b: readonly T[], maxD: number): EditOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((): EditOp => "+");
  if (m === 0) return a.map((): EditOp => "-");
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  const limit = Math.min(max, maxD);
  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): EditOp[] {
  const ops: EditOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d];
    const at = (k: number) => snap[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("=");
      x--;
      y--;
    }
    if (d > 0) ops.push(x === prevX ? "+" : "-");
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

function isWordChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return true;
  if (c === 39 || c === 95 || c === 0x2019) return true;
  // Letters from Latin-1 up through the alphabetic scripts. Ideographs
  // (U+3040 and up) are deliberately excluded, so each is its own token.
  if (c >= 0xc0 && c < 0x2000 && c !== 0xd7 && c !== 0xf7) return true;
  return false;
}

/** Split code points into word, whitespace, and single punctuation tokens. */
function tokenize(chars: readonly string[]): Array<{ start: number; end: number; text: string }> {
  const tokens: Array<{ start: number; end: number; text: string }> = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    let j = i + 1;
    // Ideographs and punctuation stand alone; spaces and word characters run.
    if (/\s/.test(ch)) {
      while (j < chars.length && /\s/.test(chars[j])) j++;
    } else if (isWordChar(ch)) {
      while (j < chars.length && isWordChar(chars[j])) j++;
    }
    tokens.push({ start: i, end: j, text: chars.slice(i, j).join("") });
    i = j;
  }
  return tokens;
}

type Hunk =
  | { kind: "equal"; from: number; to: number }
  | { kind: "change"; delFrom: number; delTo: number; ins: string[] };

/**
 * Word-level hunks turning `source` into `target`, in source char offsets.
 * A change separated from the next only by whitespace is folded into it, so
 * "walked slowly" -> "ambled" reads as one replacement, not two.
 */
function wordHunks(source: readonly string[], target: readonly string[]): Hunk[] {
  const a = tokenize(source);
  const b = tokenize(target);
  // Whitespace compares equal, so a kept word keeps the source's spacing.
  const key = (t: { text: string }) => (t.text.trim() ? t.text : " ");
  const ops = diffSequences(a.map(key), b.map(key), 2000);
  const hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    if (op === "=") {
      const tok = a[ai++];
      bi++;
      const last = hunks[hunks.length - 1];
      if (last && last.kind === "equal") last.to = tok.end;
      else hunks.push({ kind: "equal", from: tok.start, to: tok.end });
      continue;
    }
    let last = hunks[hunks.length - 1];
    if (!last || last.kind !== "change") {
      const at = ai < a.length ? a[ai].start : source.length;
      last = { kind: "change", delFrom: at, delTo: at, ins: [] };
      hunks.push(last);
    }
    if (op === "-") {
      last.delTo = a[ai].end;
      ai++;
    } else {
      last.ins.push(...target.slice(b[bi].start, b[bi].end));
      bi++;
    }
  }
  // Fold whitespace-only equal runs sitting between two changes.
  const folded: Hunk[] = [];
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    const prev = folded[folded.length - 1];
    const next = hunks[i + 1];
    if (
      h.kind === "equal" &&
      prev?.kind === "change" &&
      next?.kind === "change" &&
      source.slice(h.from, h.to).join("").trim() === ""
    ) {
      const gap = source.slice(h.from, h.to);
      prev.delTo = next.delTo;
      prev.ins = [...prev.ins, ...gap, ...next.ins];
      i += 1;
      continue;
    }
    if (h.kind === "change" && prev?.kind === "change") {
      prev.delTo = h.delTo;
      prev.ins = [...prev.ins, ...h.ins];
      continue;
    }
    folded.push(h.kind === "equal" ? { ...h } : { ...h, ins: [...h.ins] });
  }
  return folded;
}

/**
 * Turn `source` items (the text as it stands) into `target` text as a tracked
 * change: kept words stay as they are, removed words gain a deletion mark,
 * new words arrive with an insertion mark. Both halves share one id.
 */
function trackedItems(
  source: readonly TextItem[],
  target: readonly string[],
  author: SuggestionAuthor,
  id: string,
  createdAt: string
): TextItem[] {
  const del: SuggestionMark = { ...author, kind: "delete", id, createdAt };
  const ins: SuggestionMark = { ...author, kind: "insert", id, createdAt };
  const out: TextItem[] = [];
  for (const hunk of wordHunks(
    source.map((it) => it.ch),
    target
  )) {
    if (hunk.kind === "equal") {
      for (let i = hunk.from; i < hunk.to; i++) out.push({ ...source[i], sugg: null });
      continue;
    }
    for (let i = hunk.delFrom; i < hunk.delTo; i++) out.push({ ...source[i], sugg: del });
    const like = source[hunk.delFrom] ?? source[hunk.delFrom - 1] ?? source[0];
    for (const ch of hunk.ins) {
      out.push({ t: "text", ch, raw: null, fmt: like?.fmt ?? 0, wraps: like?.wraps ?? [], sugg: ins });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Proposing edits as suggestions
// ---------------------------------------------------------------------------

export type SuggestEdit = { find: string; replace: string };

export type SuggestOutcome =
  /** `conflicts` counts occurrences left alone for someone else's pending change. */
  | { status: "suggested"; count: number; conflicts: number }
  | { status: "unchanged" }
  | { status: "not_found" }
  | { status: "conflict"; authorName: string };

export type SuggestOptions = {
  author: SuggestionAuthor;
  now?: () => string;
  newId?: () => string;
  newBlockId?: () => string;
};

const BASE = (it: TextItem) => it.sugg?.kind !== "insert";
const PROPOSED = (it: TextItem) => it.sugg?.kind !== "delete";

type Projection = { text: string; itemAt: number[] };

/**
 * One block's text with whitespace collapsed, mapped back to item indices.
 * Nested block tags become a NUL so no match can straddle two inner paragraphs.
 */
function project(items: readonly Item[], keep: (it: TextItem) => boolean): Projection {
  let text = "";
  const itemAt: number[] = [];
  let space = -1;
  items.forEach((item, i) => {
    if (item.t === "tag") {
      text += "\u0000";
      itemAt.push(i);
      space = -1;
      return;
    }
    if (!keep(item)) return;
    if (/\s/.test(item.ch)) {
      if (space < 0) space = i;
      return;
    }
    if (space >= 0 && text.length > 0 && !text.endsWith("\u0000")) {
      text += " ";
      itemAt.push(space);
    }
    space = -1;
    text += item.ch;
    for (let u = 0; u < item.ch.length; u++) itemAt.push(i);
  });
  return { text, itemAt };
}

function normalizeNeedle(text: string): string {
  return text.replace(/\s+/g, " ");
}

type Conflict = { authorName: string };

/** Extend [from, to] over every item of the suggestions it overlaps. */
function claimRegion(
  items: readonly Item[],
  from: number,
  to: number,
  author: SuggestionAuthor,
  elsewhere: ReadonlySet<string>
): { from: number; to: number } | Conflict {
  let lo = from;
  let hi = to;
  const ids = new Set<string>();
  for (;;) {
    let grew = false;
    for (let i = lo; i <= hi; i++) {
      const item = items[i];
      if (item.t === "tag") return { authorName: "" };
      if (!item.sugg || ids.has(item.sugg.id)) continue;
      // Only the proposer may rework a pending change; the author's own
      // suggestions (or anyone else's) are left for the author to resolve.
      if (item.sugg.authorId !== author.authorId || elsewhere.has(item.sugg.id)) {
        return { authorName: item.sugg.authorName };
      }
      ids.add(item.sugg.id);
      grew = true;
    }
    if (!grew) return { from: lo, to: hi };
    items.forEach((item, i) => {
      if (item.t === "text" && item.sugg && ids.has(item.sugg.id)) {
        lo = Math.min(lo, i);
        hi = Math.max(hi, i);
      }
    });
  }
}

function textOf(items: readonly Item[], keep: (it: TextItem) => boolean): string[] {
  return items.filter((it): it is TextItem => isText(it) && keep(it)).map((it) => it.ch);
}

function codePoints(text: string): string[] {
  return Array.from(text);
}

type Occurrence = { from: number; to: number; view: (it: TextItem) => boolean };

function findInBlock(items: readonly Item[], needle: string): Occurrence[] {
  for (const view of [BASE, PROPOSED]) {
    const { text, itemAt } = project(items, view);
    const found: Occurrence[] = [];
    let at = text.indexOf(needle);
    while (at >= 0 && needle) {
      found.push({ from: itemAt[at], to: itemAt[at + needle.length - 1], view });
      at = text.indexOf(needle, at + needle.length);
    }
    if (found.length > 0) return found;
  }
  return [];
}

function idsSpanningBlocks(blocks: readonly Block[]): Set<string> {
  const seen = new Map<string, number>();
  const multi = new Set<string>();
  blocks.forEach((block, b) => {
    for (const item of block.items ?? []) {
      if (item.t !== "text" || !item.sugg) continue;
      const first = seen.get(item.sugg.id);
      if (first === undefined) seen.set(item.sugg.id, b);
      else if (first !== b) multi.add(item.sugg.id);
    }
  });
  return multi;
}

/**
 * Apply one find/replace as a tracked suggestion instead of an edit. Matching
 * ignores whitespace differences, looks at the text as it stands first and
 * then at the text as if pending suggestions were accepted (so the proposer
 * can rework its own pending change), and never touches a span someone else
 * has a pending suggestion on.
 */
function suggestOne(
  html: string,
  edit: SuggestEdit,
  opts: Required<SuggestOptions>
): { html: string; outcome: SuggestOutcome } {
  const needle = normalizeNeedle(edit.find);
  if (!needle.trim()) return { html, outcome: { status: "not_found" } };
  const replace = normalizeNeedle(edit.replace);
  const blocks = scanBlocks(html);
  const elsewhere = idsSpanningBlocks(blocks);
  const next = new Map<Block, string | null>();
  let count = 0;
  let unchanged = 0;
  let conflict: Conflict | null = null;
  let conflicts = 0;

  for (const block of blocks) {
    const items = block.items;
    if (!items) continue;
    const found = findInBlock(items, needle);
    if (found.length === 0) continue;
    let working: Item[] = items.slice();
    let limit = working.length;
    // Right to left, so earlier item indices stay valid as later ones change.
    for (const occ of found.slice().reverse()) {
      const region = claimRegion(working, occ.from, occ.to, opts.author, elsewhere);
      if ("authorName" in region) {
        conflict = conflict ?? region;
        conflicts += 1;
        continue;
      }
      if (region.to >= limit) continue;
      const slice = working.slice(region.from, region.to + 1);
      const source = slice.filter((it): it is TextItem => isText(it) && BASE(it));
      const target = [
        ...textOf(working.slice(region.from, occ.from), occ.view),
        ...codePoints(replace),
        ...textOf(working.slice(occ.to + 1, region.to + 1), occ.view),
      ];
      if (source.map((it) => it.ch).join("") === target.join("") && slice.every((it) => it.t === "text" && !it.sugg)) {
        unchanged += 1;
        continue;
      }
      const tracked = trackedItems(source, target, opts.author, opts.newId(), opts.now());
      working = [...working.slice(0, region.from), ...tracked, ...working.slice(region.to + 1)];
      limit = region.from;
      count += 1;
    }
    if (!sameItems(working, items)) next.set(block, blockHtml(block, working));
  }

  if (count > 0) {
    return { html: spliceBlocks(html, blocks, next), outcome: { status: "suggested", count, conflicts } };
  }
  if (conflict) return { html, outcome: { status: "conflict", authorName: conflict.authorName } };
  if (unchanged > 0) return { html, outcome: { status: "unchanged" } };
  return suggestAcrossBlocks(html, edit, opts);
}

/**
 * A find that spans whole paragraphs. Paragraphs pair up with the
 * replacement's paragraphs in order; spare old ones are marked deleted and
 * spare new ones arrive as inserted paragraphs, all under one suggestion.
 */
function suggestAcrossBlocks(
  html: string,
  edit: SuggestEdit,
  opts: Required<SuggestOptions>
): { html: string; outcome: SuggestOutcome } {
  const needle = normalizeNeedle(edit.find).trim();
  const blocks = scanBlocks(html);
  const texts = blocks.map((block) => (block.items ? project(block.items, BASE).text.trim() : null));
  for (let first = 0; first < blocks.length; first++) {
    if (!texts[first]) continue;
    let joined = "";
    for (let last = first; last < blocks.length; last++) {
      const text = texts[last];
      if (text === null) break;
      if (!text) continue;
      joined = joined ? `${joined} ${text}` : text;
      if (joined.length > needle.length) break;
      if (joined !== needle || last === first) continue;
      return suggestBlockRun(html, blocks.slice(first, last + 1), blocks, edit, opts);
    }
  }
  return { html, outcome: { status: "not_found" } };
}

function suggestBlockRun(
  html: string,
  run: readonly Block[],
  blocks: readonly Block[],
  edit: SuggestEdit,
  opts: Required<SuggestOptions>
): { html: string; outcome: SuggestOutcome } {
  const elsewhere = idsSpanningBlocks(blocks);
  for (const block of run) {
    for (const item of block.items ?? []) {
      if (item.t !== "text" || !item.sugg) continue;
      if (item.sugg.authorId !== opts.author.authorId || elsewhere.has(item.sugg.id)) {
        return { html, outcome: { status: "conflict", authorName: item.sugg.authorName } };
      }
    }
  }
  const paragraphs = edit.replace
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const prose = run.filter((block) => block.items && project(block.items, BASE).text.trim());
  const id = opts.newId();
  const createdAt = opts.now();
  const del: SuggestionMark = { ...opts.author, kind: "delete", id, createdAt };
  const ins: SuggestionMark = { ...opts.author, kind: "insert", id, createdAt };
  const next = new Map<Block, string | null>();

  prose.forEach((block, i) => {
    const items = block.items ?? [];
    const paragraph = paragraphs[i];
    const pairable = paragraph !== undefined && items.every((it) => it.t === "text");
    if (pairable) {
      const source = items.filter((it): it is TextItem => isText(it) && BASE(it));
      next.set(block, blockHtml(block, trackedItems(source, codePoints(paragraph), opts.author, id, createdAt)));
      return;
    }
    const marked = items
      .filter((it) => it.t === "tag" || BASE(it))
      .map((it): Item => (it.t === "text" ? { ...it, sugg: del } : it));
    let out = blockHtml(block, marked);
    if (paragraph !== undefined) out += insertedParagraph(paragraph, ins, opts.newBlockId());
    next.set(block, out);
  });

  const extra = paragraphs.slice(prose.length);
  if (extra.length > 0) {
    const tail = run[run.length - 1];
    const base = next.get(tail) ?? tail.html;
    next.set(tail, base + extra.map((p) => insertedParagraph(p, ins, opts.newBlockId())).join(""));
  }
  return { html: spliceBlocks(html, blocks, next), outcome: { status: "suggested", count: 1, conflicts: 0 } };
}

function insertedParagraph(text: string, ins: SuggestionMark, blockId: string): string {
  const items: TextItem[] = codePoints(text).map((ch) => ({ t: "text", ch, raw: null, fmt: 0, wraps: [], sugg: ins }));
  return `<p data-block-id="${escapeAttr(blockId)}">${serializeInline(items)}</p>`;
}

/**
 * Propose find/replace edits as tracked suggestions. Each edit is matched in
 * turn against the result of the one before; every occurrence becomes its own
 * suggestion so the author can take one and leave another.
 */
export function suggestReplacements(
  html: string,
  edits: readonly SuggestEdit[],
  options: SuggestOptions
): { html: string; outcomes: SuggestOutcome[] } {
  const opts: Required<SuggestOptions> = {
    author: options.author,
    now: options.now ?? (() => new Date().toISOString()),
    newId: options.newId ?? newSuggestionId,
    newBlockId: options.newBlockId ?? newSuggestionId,
  };
  let current = html;
  const outcomes: SuggestOutcome[] = [];
  for (const edit of edits) {
    const result = suggestOne(current, edit, opts);
    current = result.html;
    outcomes.push(result.outcome);
  }
  return { html: current, outcomes };
}

// ---------------------------------------------------------------------------
// Plain-text editors (the phone)
// ---------------------------------------------------------------------------

/**
 * Show suggestions to an editor that only knows plain marks: inserted text as
 * underline, deleted text as strikethrough. carrySuggestions reverses it.
 */
export function suggestionsAsDisplayMarks(html: string): string {
  if (!hasSuggestions(html)) return html;
  const blocks = scanBlocks(html);
  const next = new Map<Block, string | null>();
  for (const block of blocks) {
    const items = block.items;
    if (!items || !items.some((it) => it.t === "text" && it.sugg)) continue;
    next.set(
      block,
      blockHtml(
        block,
        items.map((it) =>
          it.t === "text" && it.sugg
            ? { ...it, fmt: it.fmt | (it.sugg.kind === "insert" ? FMT_UNDERLINE : FMT_STRIKE), sugg: null }
            : it
        )
      )
    );
  }
  return spliceBlocks(html, blocks, next);
}

const DISPLAY_BIT: Record<SuggestionKind, number> = { insert: FMT_UNDERLINE, delete: FMT_STRIKE };

/** Most character edits carrySuggestions aligns exactly before falling back. */
const CARRY_BUDGET = 1000;

/**
 * An insertion after a character equal to its own last character can sit on
 * either side of that character ("ambled| far home" or "ambled |far home").
 * Prefer the leftmost, so text typed after a suggestion is seen as typed
 * against it rather than after an unrelated space.
 */
function slideInsertionsLeft(ops: EditOp[], next: readonly string[]): EditOp[] {
  const out = ops.slice();
  // Each position still consumes the same element of `next` after a swap;
  // only which one the "=" pairs with changes.
  const nextIndex: number[] = [];
  let n = 0;
  for (const op of out) {
    nextIndex.push(n);
    if (op !== "-") n++;
  }
  for (let p = 0; p < out.length; p++) {
    if (out[p] !== "+" || out[p - 1] === "+") continue;
    let end = p;
    while (end < out.length && out[end] === "+") end++;
    let start = p;
    // out[start - 1] is the "=" before the run; slide while it can swap.
    while (start > 0 && out[start - 1] === "=" && next[nextIndex[start - 1]] === next[nextIndex[end - 1]]) {
      out[start - 1] = "+";
      out[end - 1] = "=";
      start--;
      end--;
    }
    p = end;
  }
  return out;
}

/**
 * Pairs of block indexes (previous, next) for ids found exactly once in each
 * document, keeping the longest run of them that stays in the same order.
 */
function sharedBlockAnchors(before: readonly Block[], after: readonly Block[]): Array<[number, number]> {
  const once = (blocks: readonly Block[]) => {
    const seen = new Map<string, number>();
    blocks.forEach((block, i) => {
      if (block.id) seen.set(block.id, seen.has(block.id) ? -1 : i);
    });
    return seen;
  };
  const prevAt = once(before);
  const pairs: Array<[number, number]> = [];
  once(after).forEach((n, id) => {
    const p = prevAt.get(id);
    if (n >= 0 && p !== undefined && p >= 0) pairs.push([p, n]);
  });
  pairs.sort((x, y) => x[1] - y[1]);
  // Longest increasing run of previous indexes (patience sorting).
  const tails: number[] = [];
  const back: number[] = [];
  pairs.forEach(([p], i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][0] < p) lo = mid + 1;
      else hi = mid;
    }
    back[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  });
  const chain: Array<[number, number]> = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = back[i]) chain.push(pairs[i]);
  return chain.reverse();
}

/**
 * Put pending suggestions back onto HTML that came out of a plain editor.
 *
 * `previous` is the last document with its suggestion marks; `next` is what
 * the editor produced from its display form (see suggestionsAsDisplayMarks),
 * edits included. Characters are aligned across the whole chapter, so a kept
 * character keeps its suggestion, a joined or split paragraph keeps its marks,
 * and the display underline or strikethrough is not mistaken for formatting.
 * New characters typed inside a suggested insertion join it. Blocks that end
 * up exactly as they were come back byte-for-byte, so an idle flush writes
 * nothing.
 */
export function carrySuggestions(previous: string, next: string): string {
  if (!hasSuggestions(previous)) return next;
  const before = scanBlocks(previous);
  const after = scanBlocks(next);
  const SEP = "\u0001";

  type NextRef = { block: number; index: number };
  const prevRun = (from: number, to: number) => {
    const chars: string[] = [];
    const refs: Array<TextItem | null> = [];
    for (let b = from; b < to; b++) {
      if (b > from) {
        chars.push(SEP);
        refs.push(null);
      }
      for (const item of before[b].items ?? []) {
        if (item.t !== "text") continue;
        chars.push(item.ch);
        refs.push(item);
      }
    }
    return { chars, refs };
  };
  const nextRun = (from: number, to: number) => {
    const chars: string[] = [];
    const refs: Array<NextRef | null> = [];
    for (let b = from; b < to; b++) {
      if (b > from) {
        chars.push(SEP);
        refs.push(null);
      }
      after[b].items?.forEach((item, index) => {
        if (item.t !== "text") return;
        chars.push(item.ch);
        refs.push({ block: b, index });
      });
    }
    return { chars, refs };
  };

  const source = new Map<string, TextItem>();
  // Align one run of previous blocks with one run of next blocks.
  const align = (prevFrom: number, prevTo: number, nextFrom: number, nextTo: number) => {
    const a = prevRun(prevFrom, prevTo);
    const b = nextRun(nextFrom, nextTo);
    const found = trimmedDiff(a.chars, b.chars, CARRY_BUDGET);
    let pi = 0;
    let ni = 0;
    for (const op of slideInsertionsLeft(found.ops, b.chars)) {
      if (op === "=") {
        const from = a.refs[pi];
        const to = b.refs[ni];
        if (from && to) source.set(`${to.block}:${to.index}`, from);
        pi++;
        ni++;
      } else if (op === "-") pi++;
      else ni++;
    }
    return found.exact;
  };

  const byId = new Map<string, Block>();
  for (const block of before) if (block.id) byId.set(block.id, block);

  if (!align(0, before.length, 0, after.length)) {
    // Edits too far apart to align as one run (a big paste in one paragraph,
    // a fix in another, a suggestion between them). Start over, cutting both
    // documents at the paragraphs that kept their id, and align each stretch
    // from one such paragraph up to the next on its own, so a paragraph
    // nobody rewrote, or one split or joined nearby, keeps its marks rather
    // than having the budget overflow wash them out.
    source.clear();
    const anchors = sharedBlockAnchors(before, after);
    let prevFrom = 0;
    let nextFrom = 0;
    for (const [p, n] of [...anchors, [before.length, after.length]]) {
      if (p > prevFrom || n > nextFrom) align(prevFrom, p, nextFrom, n);
      prevFrom = p;
      nextFrom = n;
    }
  }

  const out = new Map<Block, string | null>();

  after.forEach((block, b) => {
    const items = block.items;
    if (!items) return;
    let touched = false;
    const carried: Item[] = items.map((item, i) => {
      if (item.t !== "text") return item;
      const from = source.get(`${b}:${i}`);
      if (!from?.sugg) return item;
      touched = true;
      const bit = DISPLAY_BIT[from.sugg.kind];
      return { ...item, fmt: (item.fmt & ~bit) | (from.fmt & bit), sugg: from.sugg };
    });
    // Characters typed since. Typed inside a suggested insertion they join it;
    // typed against a suggestion's edge they shed the underline or
    // strikethrough the plain editor let them inherit from its display form.
    let i = 0;
    while (i < carried.length) {
      if (carried[i].t !== "text" || source.has(`${b}:${i}`)) {
        i++;
        continue;
      }
      let end = i;
      while (end < carried.length && carried[end].t === "text" && !source.has(`${b}:${end}`)) end++;
      const left = carried[i - 1];
      const right = carried[end];
      const leftMark = left?.t === "text" ? left.sugg : null;
      const rightMark = right?.t === "text" ? right.sugg : null;
      const inherit = left?.t === "text" ? left : right?.t === "text" ? right : null;
      for (let k = i; k < end; k++) {
        const item = carried[k] as TextItem;
        if (leftMark?.kind === "insert" && rightMark && suggestionKey(leftMark) === suggestionKey(rightMark)) {
          touched = true;
          carried[k] = { ...item, fmt: (item.fmt & ~FMT_UNDERLINE) | ((left as TextItem).fmt & FMT_UNDERLINE), sugg: leftMark };
          continue;
        }
        if (inherit?.sugg) {
          const bit = DISPLAY_BIT[inherit.sugg.kind];
          if (item.fmt & bit && !(inherit.fmt & bit)) {
            touched = true;
            carried[k] = { ...item, fmt: item.fmt & ~bit };
          }
        }
      }
      i = end;
    }
    if (!touched) return;
    const was = block.id ? byId.get(block.id) : undefined;
    if (was?.items && sameItems(was.items, carried)) out.set(block, was.html);
    else out.set(block, blockHtml(block, carried));
  });
  return spliceBlocks(next, after, out);
}
