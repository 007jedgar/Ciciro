import {
  diffHtmlToOps,
  htmlToDoc,
  newBlockId,
  type DiffHtmlOptions,
  type ManuscriptBlock,
  type ManuscriptOp,
} from "./manuscript";
import { carrySuggestions, suggestionsAsDisplayMarks } from "./suggestions";

export const SCENE_BREAK_TEXT = "***";

/** Enriched's native view does not keep `data-block-id`. Strip it on the way in. */
export function stripBlockIds(html: string): string {
  return html.replace(/\s*data-block-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function unwrapShell(html: string): string {
  return html.replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "").trim();
}

function canonicalizeInline(html: string): string {
  return html
    .replace(/<\/?strong\b/gi, (tag) => tag.replace(/strong/i, "b"))
    .replace(/<\/?em\b/gi, (tag) => tag.replace(/em/i, "i"));
}

function ciciroInline(html: string): string {
  return html
    .replace(/<\/?b\b/gi, (tag) => tag.replace(/\bb\b/i, "strong"))
    .replace(/<\/?i\b/gi, (tag) => tag.replace(/\bi\b/i, "em"));
}

function unwrapQuoteInners(html: string): string {
  return html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_full, inner: string) => {
    const stripped = String(inner).replace(
      /<\/?(?:p|div|blockquoteitem|blockquote-content)\b[^>]*>/gi,
      ""
    );
    return `<blockquote>${stripped}</blockquote>`;
  });
}

function brToEmptyParagraphs(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "<p></p>");
}

function sceneBreaksToHr(html: string): string {
  return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (full, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text === SCENE_BREAK_TEXT || text === "#" || text === "##" || text === "###") {
      return "<hr />";
    }
    return full;
  });
}

function hrToParagraph(html: string): string {
  return html.replace(/<hr\b[^>]*\/?>/gi, `<p>${SCENE_BREAK_TEXT}</p>`);
}

function wrapBareListItems(html: string): string {
  return html.replace(/(?:<li\b[^>]*>[\s\S]*?<\/li>\s*)+/gi, (run) => `<ul>${run}</ul>`);
}

/**
 * Enriched's iOS parser only treats a string as HTML once it is at least this
 * long (or already wrapped in `<html>`). Shorter markup, including a new
 * chapter's `<p></p>`, is inserted as plain text.
 */
const ENRICHED_MIN_PARSED_HTML = 13;

function ensureEnrichedParses(html: string): string {
  if (html.replace(/\s+/g, "").length >= ENRICHED_MIN_PARSED_HTML) return html;
  return `<html>${html}</html>`;
}

/**
 * Ciciro stamped HTML → what EnrichedTextInput will parse. The native editor
 * has no tracked-change marks, so pending suggestions show as underline
 * (inserted) and strikethrough (deleted); opsFromEnrichedHtml puts them back.
 */
export function toEnrichedHtml(html: string): string {
  const stripped = stripBlockIds(suggestionsAsDisplayMarks(html.trim()));
  const body = !stripped
    ? "<p></p>"
    : wrapBareListItems(hrToParagraph(canonicalizeInline(stripped)));
  return ensureEnrichedParses(body);
}

/**
 * Enriched getHTML() → Ciciro-shaped blocks as the editor shows them: scene
 * breaks stay the paragraphs the writer sees, so text offsets still line up.
 */
export function fromEnrichedHtmlAsShown(html: string): string {
  return unwrapQuoteInners(ciciroInline(brToEmptyParagraphs(unwrapShell(html)))).trim();
}

/** Enriched getHTML() → Ciciro-shaped blocks, still without durable ids. */
export function fromEnrichedHtml(html: string): string {
  return sceneBreaksToHr(fromEnrichedHtmlAsShown(html)).trim();
}

function sameBlock(a: ManuscriptBlock, b: ManuscriptBlock): boolean {
  return a.kind === b.kind && a.text === b.text;
}

function assignIds(oldBlocks: ManuscriptBlock[], nextBlocks: ManuscriptBlock[]): string[] {
  if (oldBlocks.length === nextBlocks.length) {
    return oldBlocks.map((block) => block.id);
  }
  const n = oldBlocks.length;
  const m = nextBlocks.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = sameBlock(oldBlocks[i], nextBlocks[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched: Array<string | null> = Array(m).fill(null);
  const used = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sameBlock(oldBlocks[i], nextBlocks[j])) {
      matched[j] = oldBlocks[i].id;
      used.add(oldBlocks[i].id);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  // Return that splits one paragraph: reuse the left id for the first unmatched
  // new block that sits where the old one was.
  for (let oi = 0; oi < n; oi++) {
    if (used.has(oldBlocks[oi].id)) continue;
    const around = Math.min(oi, m - 1);
    for (const candidate of [around, around - 1, around + 1]) {
      if (candidate >= 0 && candidate < m && matched[candidate] == null) {
        matched[candidate] = oldBlocks[oi].id;
        used.add(oldBlocks[oi].id);
        break;
      }
    }
  }
  return matched.map((id) => id ?? newBlockId());
}

function stampId(raw: string, id: string): string {
  if (/^<hr\b/i.test(raw)) {
    if (/\bdata-block-id\s*=/.test(raw)) {
      return raw.replace(
        /\bdata-block-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        `data-block-id="${id}"`
      );
    }
    return raw.replace(/^<hr\b/i, `<hr data-block-id="${id}"`);
  }
  return raw.replace(/^<([a-z][\w-]*)\b([^>]*)>/i, (_full, tag: string, attrs: string) => {
    if (/\bdata-block-id\s*=/.test(attrs)) {
      return `<${tag}${attrs.replace(
        /\bdata-block-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        `data-block-id="${id}"`
      )}>`;
    }
    return `<${tag} data-block-id="${id}"${attrs}>`;
  });
}

/** Put previous block ids back onto freshly parsed Enriched HTML. */
export function restampCiciroHtml(previous: string, incoming: string): string {
  const oldBlocks = htmlToDoc(previous || "<p></p>", 0).doc.blocks;
  const nextBlocks = htmlToDoc(incoming || "<p></p>", 0).doc.blocks;
  if (nextBlocks.length === 0) return previous;
  const ids = assignIds(oldBlocks, nextBlocks);
  return nextBlocks.map((block, index) => stampId(stripBlockIds(block.html), ids[index])).join("");
}

export function opsFromEnrichedHtml(
  previousCiciroHtml: string,
  enrichedHtml: string,
  revision: number,
  opts?: DiffHtmlOptions
): ManuscriptOp[] {
  const incoming = carrySuggestions(
    previousCiciroHtml,
    restampCiciroHtml(previousCiciroHtml, fromEnrichedHtml(enrichedHtml))
  );
  if (!incoming) return [];
  return diffHtmlToOps(previousCiciroHtml || "<p></p>", incoming, revision, opts);
}

/**
 * How many characters the editor shows for a block: an `<hr>` reads as "***";
 * a scene break the writer typed ("#", "**") shows as typed.
 */
export function editorBlockLength(block: ManuscriptBlock): number {
  return /^<hr\b/i.test(block.html) ? SCENE_BREAK_TEXT.length : block.text.length;
}

/**
 * Find the block under an editor caret offset (paragraphs newline-separated,
 * scene breaks counted as the editor displays them). `start` is the block's
 * own offset in the editor.
 */
export function locateEditorOffset(
  blocks: ManuscriptBlock[],
  offset: number
): { index: number; local: number; start: number } {
  let remaining = Math.max(0, offset);
  let start = 0;
  for (let index = 0; index < blocks.length; index++) {
    const len = editorBlockLength(blocks[index]);
    if (remaining <= len) return { index, local: remaining, start };
    remaining -= len + 1;
    start += len + 1;
  }
  const index = blocks.length - 1;
  const last = blocks[index];
  const len = editorBlockLength(last);
  return { index, local: len, start: start - len - 1 };
}

/** Map a document-level caret onto a Ciciro block, treating paragraphs as newline-separated. */
export function blockAtPlainOffset(
  html: string,
  offset: number
): { blockId: string; local: number } | null {
  const blocks = htmlToDoc(html || "<p></p>", 0).doc.blocks;
  if (blocks.length === 0) return null;
  const { index, local } = locateEditorOffset(blocks, offset);
  return { blockId: blocks[index].id, local };
}
