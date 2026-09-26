import { escapeHtmlText } from "./block-editor";
import {
  htmlToDoc,
  docToHtml,
  newBlockId,
  type ManuscriptBlock,
} from "./manuscript";

// Pure helpers for dictation. The recognizer itself lives in lib/speech.ts.

const COMMANDS: [RegExp, string][] = [
  [/\s*\bnew paragraph\b[.,]?\s*/gi, "\n\n"],
  [/\s*\bnew line\b[.,]?\s*/gi, "\n"],
  [/\s*\bquestion mark\b/gi, "?"],
  [/\s*\bexclamation (?:mark|point)\b/gi, "!"],
  [/\s*\bfull stop\b/gi, "."],
  [/\s*\bsemicolon\b/gi, ";"],
  [/\s*\bcolon\b/gi, ":"],
];

/** Spoken layout and punctuation ("new paragraph", "question mark"), English only. */
export function applyDictationCommands(text: string, lang: string): string {
  if (!/^en(?:$|[-_])/i.test(lang)) return text;
  let out = text;
  for (const [pattern, replacement] of COMMANDS)
    out = out.replace(pattern, replacement);
  return out;
}

/**
 * Shape a final transcript for the spot it lands in. `before` is the text
 * just ahead of the caret in its paragraph (empty at a paragraph start).
 * Adds the joining space and capitalizes a sentence start.
 */
export function prepareDictation(
  raw: string,
  before: string,
  lang = "en",
): string {
  let text = applyDictationCommands(raw.trim(), lang);
  if (!text) return "";
  const startsSentence =
    before.trim() === "" || /[.!?…]["'”’)]*\s*$/.test(before);
  if (startsSentence && /^[a-z]/.test(text))
    text = text[0].toUpperCase() + text.slice(1);
  text = text.replace(
    /(\n+)([a-z])/g,
    (_m, nl: string, c: string) => nl + c.toUpperCase(),
  );
  const needsSpace =
    before !== "" &&
    !/\s$/.test(before) &&
    !text.startsWith("\n") &&
    !/^[.,;:!?)\]”’]/.test(text);
  return needsSpace ? ` ${text}` : text;
}

/** How far the caret moves: a paragraph or line break is one plain-text character. */
export function dictatedLength(prepared: string): number {
  return prepared.replace(/\n+/g, "\n").length;
}

/** Step past closing inline marks so dictation lands outside bold or italic, not inside. */
function skipInlineClosers(html: string, from: number): number {
  const closer = /^<\/(?:strong|em|b|i|u|s|strike|a|span|code)>/i;
  let i = from;
  for (let m = closer.exec(html.slice(i)); m; m = closer.exec(html.slice(i)))
    i += m[0].length;
  return i;
}

/** Index in a block's HTML just after its `local`th plain-text character. */
function htmlIndexAtTextOffset(html: string, local: number): number {
  const open = html.indexOf(">") + 1;
  if (local <= 0) return open;
  let count = 0;
  let i = open;
  let last = open;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      const end = html.indexOf(">", i);
      const tag = html.slice(i, end + 1);
      i = end < 0 ? html.length : end + 1;
      if (/^<br\b/i.test(tag)) {
        count += 1;
        last = i;
        if (count >= local) return skipInlineClosers(html, i);
      }
      continue;
    }
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      i = semi > 0 && semi - i <= 8 ? semi + 1 : i + 1;
    } else if (/\s/.test(ch)) {
      while (i < html.length && /\s/.test(html[i])) i += 1;
    } else {
      i += 1;
    }
    count += 1;
    last = i;
    if (count >= local) return skipInlineClosers(html, i);
  }
  // Past the end of the text: land before the closing tag.
  const close = html.lastIndexOf("</");
  return close >= last ? close : last;
}

function blockAt(
  blocks: ManuscriptBlock[],
  offset: number,
): { index: number; local: number } {
  let remaining = Math.max(0, offset);
  for (let index = 0; index < blocks.length; index++) {
    const len = blocks[index].text.length;
    if (remaining <= len) return { index, local: remaining };
    remaining -= len + 1;
  }
  const last = blocks.length - 1;
  return { index: last, local: blocks[last].text.length };
}

/**
 * Insert a dictated phrase into Ciciro block HTML at a document-level caret
 * offset (paragraphs counted as newline-separated, as the editor reports it).
 * A spoken paragraph break splits a paragraph; elsewhere it becomes a line
 * break. Returns the new HTML and where the caret should land.
 */
export function insertDictation(
  html: string,
  docOffset: number,
  raw: string,
  lang = "en",
): { html: string; caret: number } | null {
  const { doc } = htmlToDoc(html || "<p></p>", 0);
  const blocks = doc.blocks;
  if (blocks.length === 0) return null;
  const { index, local } = blockAt(blocks, docOffset);
  const block = blocks[index];
  const prepared = prepareDictation(raw, block.text.slice(0, local), lang);
  if (!prepared) return null;
  const caret = docOffset + dictatedLength(prepared);

  if (block.kind === "scene_break") {
    const fresh = `<p data-block-id="${newBlockId()}">${escapeHtmlText(prepared.trim().replace(/\n+/g, " "))}</p>`;
    const next = [...blocks];
    next.splice(index + 1, 0, {
      ...block,
      id: "",
      html: fresh,
      text: "",
      kind: "paragraph",
    });
    return { html: docToHtml({ ...doc, blocks: next }), caret: caret + 1 };
  }

  const splitsParagraph = block.kind === "paragraph";
  const pieces = prepared
    .split(/\n{2,}/)
    .map((piece) => escapeHtmlText(piece).replace(/\n/g, "<br>"));
  const joined = splitsParagraph ? pieces : [pieces.join(" ")];
  const at = htmlIndexAtTextOffset(block.html, local);
  const head = block.html.slice(0, at);
  const tail = block.html.slice(at);

  if (joined.length === 1) {
    const next = [...blocks];
    next[index] = { ...block, html: head + joined[0] + tail };
    return { html: docToHtml({ ...doc, blocks: next }), caret };
  }

  // Split the paragraph: text before the caret plus the first phrase stay
  // put; each later phrase opens a new paragraph, the last one keeping the tail.
  const tag = block.html.match(/^<([a-z][\w-]*)/i)?.[1] ?? "p";
  const opening = (id: string) => `<${tag} data-block-id="${id}">`;
  const closing = `</${tag}>`;
  const bodyTail = tail.replace(new RegExp(`</${tag}>\\s*$`, "i"), "");
  let out = head + joined[0] + closing;
  for (let i = 1; i < joined.length; i++) {
    const isLast = i === joined.length - 1;
    out +=
      opening(newBlockId()) + joined[i] + (isLast ? bodyTail : "") + closing;
  }
  const next = [...blocks];
  next[index] = { ...block, html: out };
  return { html: docToHtml({ ...doc, blocks: next }), caret };
}

const LOCALES: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  hi: "hi-IN",
  zh: "zh-CN",
};

/** The recognizer wants a region-qualified tag; map the app language to one. */
export function dictationLocale(language: string): string {
  if (language.includes("-")) return language;
  return LOCALES[language] ?? "en-US";
}
