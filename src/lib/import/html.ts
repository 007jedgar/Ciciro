import {
  chapterize,
  headingBlock,
  paragraphBlock,
  type ImportBlock,
  type ImportedManuscript,
  type Run,
} from "./blocks";
import { elementChildren, findAll, parseMarkup, type MarkupNode } from "./markup";

type Fmt = { bold: boolean; italic: boolean; strike: boolean };

const BLOCKS = new Set(["p", "div", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "pre", "section", "article"]);
const SKIP = new Set(["script", "style", "head", "title", "meta", "link", "img", "svg", "table-of-contents"]);

function styleValue(style: string | undefined, prop: string): string | null {
  if (!style) return null;
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i"));
  return m ? m[1].trim().toLowerCase() : null;
}

function isBold(value: string): boolean {
  if (value === "bold" || value === "bolder") return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= 600;
}

/** Tag semantics first, then inline style: Google Docs wraps everything in <b style="font-weight:normal">. */
function nextFmt(node: MarkupNode, fmt: Fmt): Fmt {
  const next = { ...fmt };
  if (node.name === "b" || node.name === "strong") next.bold = true;
  if (node.name === "i" || node.name === "em") next.italic = true;
  if (node.name === "s" || node.name === "strike" || node.name === "del") next.strike = true;
  const weight = styleValue(node.attrs.style, "font-weight");
  if (weight) next.bold = isBold(weight);
  const italic = styleValue(node.attrs.style, "font-style");
  if (italic) next.italic = italic === "italic" || italic === "oblique";
  const deco = styleValue(node.attrs.style, "text-decoration");
  if (deco && deco.includes("line-through")) next.strike = true;
  return next;
}

function collectBlocks(root: MarkupNode): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  let runs: Run[] = [];
  let marker = "";

  const flush = (level?: number, quote?: boolean) => {
    if (marker && !level && runs.some((r) => r.text.trim())) {
      runs.unshift({ text: marker });
      marker = "";
    }
    const block = level ? headingBlock(level, runs) : paragraphBlock(runs);
    if (block) blocks.push(block.kind === "paragraph" && quote ? { ...block, kind: "quote" } : block);
    runs = [];
  };

  const walk = (node: MarkupNode, fmt: Fmt, quote: boolean) => {
    for (const child of node.children) {
      if (typeof child === "string") {
        runs.push({ text: child.replace(/\s+/g, " "), ...fmt });
        continue;
      }
      if (SKIP.has(child.name)) continue;
      const childFmt = nextFmt(child, fmt);
      if (child.name === "br") {
        runs.push({ text: " ", ...fmt });
      } else if (child.name === "hr") {
        flush();
        blocks.push({ kind: "break" });
      } else if (/^h[1-6]$/.test(child.name)) {
        flush();
        // Headings carry their own weight; only the text matters.
        walk(child, { bold: false, italic: false, strike: false }, false);
        flush(Number(child.name[1]));
      } else if (BLOCKS.has(child.name)) {
        flush();
        const isQuote = quote || child.name === "blockquote";
        if (child.name === "li") marker = listMarker(node, child);
        walk(child, childFmt, isQuote);
        flush(undefined, isQuote);
        if (child.name === "li") marker = "";
      } else if (child.name === "ul" || child.name === "ol") {
        flush();
        walk(child, childFmt, quote);
      } else {
        walk(child, childFmt, quote);
      }
    }
  };

  walk(root, { bold: false, italic: false, strike: false }, false);
  flush();
  return blocks;
}

function listMarker(list: MarkupNode, item: MarkupNode): string {
  if (list.name !== "ol") return "• ";
  return `${elementChildren(list).filter((c) => c.name === "li").indexOf(item) + 1}. `;
}

/** HTML (a saved page or pasted Google Docs markup) to chapters. */
export function parseHtml(source: string, fallbackTitle = ""): ImportedManuscript {
  const root = parseMarkup(source, { html: true });
  const body = findAll(root, "body")[0] ?? root;
  const docTitle = findAll(root, "title")[0]?.children.find((c) => typeof c === "string");
  const result = chapterize(collectBlocks(body), fallbackTitle);
  const title = result.title || (typeof docTitle === "string" ? docTitle.trim() : "");
  return { ...result, title };
}
