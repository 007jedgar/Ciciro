import { escapeHtmlText } from "./block-editor";
import { editorBlockLength, locateEditorOffset } from "./enriched-html";
import {
  htmlToDoc,
  docToHtml,
  newBlockId,
  type ManuscriptBlock,
} from "./manuscript";

// Pure helpers for dictation. The recognizer itself lives in lib/speech.ts.

const COMMANDS = new Map<string, string>([
  ["new paragraph", "\n\n"],
  ["new line", "\n"],
  ["question mark", "?"],
  ["exclamation mark", "!"],
  ["exclamation point", "!"],
  ["full stop", "."],
  ["semicolon", ";"],
  ["colon", ":"],
]);

/**
 * Spoken layout and punctuation ("new paragraph", "question mark"), English
 * only. A command counts only when it is the whole phrase, so prose such as
 * "came to a full stop" stays as spoken.
 */
export function applyDictationCommands(text: string, lang: string): string {
  if (!/^en(?:$|[-_])/i.test(lang)) return text;
  const phrase = text
    .trim()
    .replace(/[.,!?]+$/, "")
    .trim()
    .toLowerCase();
  return COMMANDS.get(phrase) ?? text;
}

/**
 * Shape a final transcript for the spot it lands in. `before` is the text
 * just ahead of the caret in its paragraph (empty at a paragraph start) and
 * `after` the text just behind it. Adds the joining spaces and capitalizes a
 * sentence start.
 */
export function prepareDictation(
  raw: string,
  before: string,
  lang = "en",
  after = "",
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
  const needsTrailingSpace =
    /^[\p{L}\p{N}]/u.test(after) && !/\s$/.test(text);
  return `${needsSpace ? " " : ""}${text}${needsTrailingSpace ? " " : ""}`;
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

/**
 * Insert a dictated phrase into Ciciro block HTML at the editor's caret offset
 * (paragraphs counted as newline-separated and scene breaks as the "***" the
 * editor shows). The phone editor has no line break inside a block, so a
 * spoken paragraph or line break splits a paragraph and is dropped elsewhere.
 * Returns the new HTML and where the caret should land.
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
  const { index, local, start } = locateEditorOffset(blocks, docOffset);
  const block = blocks[index];

  if (block.kind === "scene_break") {
    const text = prepareDictation(raw, "", lang).replace(/\s*\n+\s*/g, " ").trim();
    if (!text) return null;
    const fresh = `<p data-block-id="${newBlockId()}">${escapeHtmlText(text)}</p>`;
    const next = [...blocks];
    next.splice(index + 1, 0, {
      ...block,
      id: "",
      html: fresh,
      text: "",
      kind: "paragraph",
    });
    const caret = start + editorBlockLength(block) + 1 + text.length;
    return { html: docToHtml({ ...doc, blocks: next }), caret };
  }

  const prepared = prepareDictation(
    raw,
    block.text.slice(0, local),
    lang,
    block.text.slice(local),
  );
  if (!prepared) return null;
  const pieces = prepared.split(/\n+/);
  const texts =
    block.kind === "paragraph" ? pieces : [pieces.join(" ").replace(/ {2,}/g, " ")];
  if (texts.length === 1 && !texts[0].trim()) return null;
  const caret = start + local + texts.join("\n").length;
  const joined = texts.map(escapeHtmlText);
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
  const bodyTail = tail
    .replace(new RegExp(`</${tag}>\\s*$`, "i"), "")
    .replace(/^\s+/, "");
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
