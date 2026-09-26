import { htmlToDoc } from "@/lib/manuscript";
import { blockVisibleText } from "@/lib/manuscript-search";
import { nearestOccurrence, type CommentAnchor } from "@/lib/share-view";

// Chapter HTML for people who are not the author. The reader page renders it
// with dangerouslySetInnerHTML, so it is rebuilt from an allowlist: known
// formatting tags with no attributes except a block id, text re-escaped, and
// the contents of anything executable dropped outright.

const ALLOWED = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "code",
  "pre",
  "sub",
  "sup",
]);
const VOID = new Set(["br", "hr"]);
// Their text is not prose: never show it, even as plain text.
const DROP_CONTENT = new Set([
  "script",
  "style",
  "template",
  "iframe",
  "object",
  "embed",
  "noscript",
  "textarea",
  "title",
  "svg",
  "math",
]);

const TOKEN = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
const TAG = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/;
const BLOCK_ID = /\bdata-block-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/ /g, "&nbsp;");
}

/** Chapter HTML reduced to safe formatting. Block ids survive for anchoring. */
export function sanitizeReaderHtml(html: string): string {
  let out = "";
  // Name of the executable element whose contents are being skipped.
  let skipping: string | null = null;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    const raw = m[0];
    if (raw.startsWith("<!--")) continue;
    if (raw[0] !== "<") {
      if (!skipping) out += escapeText(decode(raw));
      continue;
    }
    const tag = raw.match(TAG);
    if (!tag) continue;
    const closing = Boolean(tag[1]);
    const name = tag[2].toLowerCase();
    if (skipping) {
      if (closing && name === skipping) skipping = null;
      continue;
    }
    if (DROP_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(tag[3])) skipping = name;
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      if (!VOID.has(name)) out += `</${name}>`;
      continue;
    }
    const idMatch = tag[3].match(BLOCK_ID);
    const id = idMatch ? (idMatch[1] ?? idMatch[2] ?? idMatch[3] ?? "") : "";
    out += SAFE_ID.test(id) ? `<${name} data-block-id="${id}">` : `<${name}>`;
  }
  return out;
}

type CommentPlace = { blockId: string; quote: string; offset: number };

/**
 * A finder for where comments' passages sit in `html` now: the occurrence of
 * the quote nearest where the reader saw it, in its own paragraph first and
 * then anywhere in the chapter. When the quote was edited away but its
 * paragraph remains, the paragraph (length 0). Null when both are gone.
 */
export function commentAnchorLocator(html: string): (comment: CommentPlace) => CommentAnchor | null {
  const blocks = htmlToDoc(html, 0)
    .doc.blocks.filter((b) => b.kind !== "scene_break")
    .map((b) => ({ id: b.id, text: blockVisibleText(b.html) }));
  const byId = new Map(blocks.map((b) => [b.id, b.text]));
  return (comment) => {
    const own = byId.get(comment.blockId);
    if (own !== undefined) {
      const at = nearestOccurrence(own, comment.quote, comment.offset);
      if (at >= 0) return { blockId: comment.blockId, offset: at, length: comment.quote.length };
    }
    for (const block of blocks) {
      if (block.id === comment.blockId) continue;
      const at = nearestOccurrence(block.text, comment.quote, 0);
      if (at >= 0) return { blockId: block.id, offset: at, length: comment.quote.length };
    }
    if (own !== undefined) {
      return { blockId: comment.blockId, offset: Math.min(comment.offset, own.length), length: 0 };
    }
    return null;
  };
}

export function locateCommentAnchor(html: string, comment: CommentPlace): CommentAnchor | null {
  return commentAnchorLocator(html)(comment);
}

/** Block ids a reader may anchor a comment to: every block with prose. */
export function commentableBlockIds(html: string): Set<string> {
  return new Set(
    htmlToDoc(html, 0)
      .doc.blocks.filter((b) => b.kind !== "scene_break")
      .map((b) => b.id)
  );
}
