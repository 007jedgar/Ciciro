import {
  chapterize,
  escapeHtml,
  headingBlock,
  isBreakText,
  type ImportBlock,
  type ImportedManuscript,
  type Run,
} from "./blocks";

const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ATX_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(```|~~~)/;
const LIST_RE = /^ {0,3}(?:([-*+])|(\d{1,9})[.)])[ \t]+(.*)$/;

/** Inline markdown to HTML: bold, italic, strike; links and code become text. */
export function inlineMarkdownToHtml(source: string): string {
  const stash: string[] = [];
  const keep = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = source
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, (_, ch: string) => keep(escapeHtml(ch)))
    .replace(/`+([^`]+)`+/g, (_, code: string) => keep(escapeHtml(code)))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1");
  s = escapeHtml(s)
    .replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/g, "<strong>$1</strong>")
    .replace(/\*(?=[^\s*])(.+?)(?<=[^\s*])\*/g, "<em>$1</em>")
    .replace(/(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])/g, "<em>$1</em>")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<s>$1</s>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => stash[Number(i)]);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function frontMatterTitle(lines: string[]): { title: string; rest: string[] } {
  if (lines[0]?.trim() !== "---") return { title: "", rest: lines };
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) return { title: "", rest: lines };
  const meta = lines.slice(1, end).join("\n");
  const m = meta.match(/^title:\s*(.+)$/im);
  const title = m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") : "";
  return { title, rest: lines.slice(end + 1) };
}

/** Markdown (.md) to chapters, split on headings. */
export function parseMarkdown(source: string, fallbackTitle = ""): ImportedManuscript {
  const all = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const { title: metaTitle, rest: lines } = frontMatterTitle(all);
  const blocks: ImportBlock[] = [];
  let para: string[] = [];
  let quote: string[] = [];

  const pushParagraph = (raw: string, kind: "paragraph" | "quote") => {
    const html = inlineMarkdownToHtml(raw);
    const text = stripTags(html).trim();
    if (!text) return;
    if (kind === "paragraph" && isBreakText(text)) blocks.push({ kind: "break" });
    else blocks.push({ kind, html, text });
  };
  const flushPara = () => {
    if (para.length) pushParagraph(para.map((l) => l.trim()).join(" "), "paragraph");
    para = [];
  };
  const flushQuote = () => {
    if (quote.length) pushParagraph(quote.join(" "), "quote");
    quote = [];
  };
  const flush = () => {
    flushPara();
    flushQuote();
  };
  const heading = (level: number, text: string) => {
    const html = inlineMarkdownToHtml(text);
    const runs: Run[] = [{ text: stripTags(html) }];
    const block = headingBlock(level, runs);
    if (block) blocks.push(block);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const fence = line.match(FENCE_RE);
    if (fence) {
      flush();
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) {
        if (lines[i].trim()) pushParagraph(escapeMarkdown(lines[i]), "paragraph");
        i++;
      }
      continue;
    }
    const atx = line.match(ATX_RE);
    if (atx) {
      flush();
      heading(atx[1].length, atx[2]);
      continue;
    }
    // Setext: a text line directly followed by === or --- underlines.
    const next = lines[i + 1];
    if (para.length === 0 && next !== undefined && /^ {0,3}=+[ \t]*$/.test(next)) {
      flush();
      heading(1, line.trim());
      i++;
      continue;
    }
    if (para.length === 0 && next !== undefined && /^ {0,3}-+[ \t]*$/.test(next) && !HR_RE.test(line)) {
      flush();
      heading(2, line.trim());
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      flush();
      blocks.push({ kind: "break" });
      continue;
    }
    const quoteLine = line.match(/^ {0,3}>[ \t]?(.*)$/);
    if (quoteLine) {
      flushPara();
      quote.push(quoteLine[1].trim());
      continue;
    }
    flushQuote();
    const item = line.match(LIST_RE);
    if (item) {
      flushPara();
      pushParagraph(`${item[1] ? "•" : `${item[2]}.`} ${item[3]}`, "paragraph");
      continue;
    }
    para.push(line);
  }
  flush();

  const result = chapterize(blocks, fallbackTitle);
  return { ...result, title: metaTitle || result.title };
}

function escapeMarkdown(line: string): string {
  return line.replace(/[\\`*_~[\]]/g, (c) => `\\${c}`);
}
