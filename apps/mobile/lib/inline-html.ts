function encode(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type InlineMarks = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
};

export type InlineSpan = InlineMarks & { text: string };

export type InlineMark = keyof InlineMarks;

export function emptyInlineMarks(): InlineMarks {
  return { bold: false, italic: false, underline: false, strike: false };
}

export function marksEqual(a: InlineMarks, b: InlineMarks): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike;
}

export function innerHtmlOf(html: string): string {
  if (/^<hr\b/i.test(html)) return "";
  const match = html.match(/^<([a-z][a-z0-9]*)\b[^>]*>([\s\S]*)<\/\1>\s*$/i);
  return match ? match[2] : html;
}

export function wrapBlockHtml(blockId: string, tag: string, inner: string): string {
  if (tag === "hr") return `<hr data-block-id="${blockId}" />`;
  return `<${tag} data-block-id="${blockId}">${inner}</${tag}>`;
}

const OPEN = /^(strong|b|em|i|u|s|strike|del)$/i;

function applyTag(marks: InlineMarks, tag: string, on: boolean): InlineMarks {
  const name = tag.toLowerCase();
  if (name === "strong" || name === "b") return { ...marks, bold: on };
  if (name === "em" || name === "i") return { ...marks, italic: on };
  if (name === "u") return { ...marks, underline: on };
  if (name === "s" || name === "strike" || name === "del") return { ...marks, strike: on };
  return marks;
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseInlineHtml(inner: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let marks = emptyInlineMarks();
  let i = 0;
  let text = "";

  function flush() {
    if (!text) return;
    const last = spans[spans.length - 1];
    if (last && marksEqual(last, marks)) {
      last.text += text;
    } else {
      spans.push({ ...marks, text });
    }
    text = "";
  }

  while (i < inner.length) {
    if (inner[i] !== "<") {
      const next = inner.indexOf("<", i);
      const chunk = next === -1 ? inner.slice(i) : inner.slice(i, next);
      text += decode(chunk);
      i += chunk.length;
      continue;
    }
    const close = inner.indexOf(">", i + 1);
    if (close === -1) {
      text += inner.slice(i);
      break;
    }
    flush();
    const raw = inner.slice(i + 1, close).trim();
    i = close + 1;
    if (!raw || raw.startsWith("!")) continue;
    const closing = raw.startsWith("/");
    const name = (closing ? raw.slice(1) : raw).split(/\s+/)[0] ?? "";
    if (!OPEN.test(name)) continue;
    marks = applyTag(marks, name.replace(/\/$/, ""), !closing);
  }
  flush();
  return spans;
}

export function spansToText(spans: readonly InlineSpan[]): string {
  return spans.map((span) => span.text).join("");
}

function encodeSpan(span: InlineSpan): string {
  let inner = encode(span.text);
  if (span.strike) inner = `<s>${inner}</s>`;
  if (span.underline) inner = `<u>${inner}</u>`;
  if (span.italic) inner = `<em>${inner}</em>`;
  if (span.bold) inner = `<strong>${inner}</strong>`;
  return inner;
}

export function serializeInlineHtml(spans: readonly InlineSpan[]): string {
  return spans
    .filter((span) => span.text.length > 0)
    .map(encodeSpan)
    .join("");
}

function toChars(spans: readonly InlineSpan[]): InlineMarks[] {
  const chars: InlineMarks[] = [];
  for (const span of spans) {
    for (let i = 0; i < span.text.length; i++) chars.push(span);
  }
  return chars;
}

function fromChars(text: string, chars: readonly InlineMarks[]): InlineSpan[] {
  const spans: InlineSpan[] = [];
  for (let i = 0; i < text.length; i++) {
    const marks = chars[i] ?? emptyInlineMarks();
    const last = spans[spans.length - 1];
    if (last && marksEqual(last, marks)) {
      last.text += text[i];
    } else {
      spans.push({ ...marks, text: text[i]! });
    }
  }
  return spans;
}

export function marksCovering(inner: string, start: number, end: number): InlineMarks {
  const spans = parseInlineHtml(inner);
  const text = spansToText(spans);
  if (text.length === 0) return emptyInlineMarks();
  if (start === end) {
    const at = start < text.length ? start : Math.max(0, text.length - 1);
    const chars = toChars(spans);
    return chars[at] ? { ...chars[at]! } : emptyInlineMarks();
  }
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const chars = toChars(spans);
  const slice = chars.slice(from, to);
  if (slice.length === 0) return emptyInlineMarks();
  return {
    bold: slice.every((mark) => mark.bold),
    italic: slice.every((mark) => mark.italic),
    underline: slice.every((mark) => mark.underline),
    strike: slice.every((mark) => mark.strike),
  };
}

export function toggleMarkInRange(inner: string, start: number, end: number, mark: InlineMark): string {
  const spans = parseInlineHtml(inner);
  const text = spansToText(spans);
  let from = Math.max(0, Math.min(start, text.length));
  let to = Math.max(0, Math.min(end, text.length));
  if (from === to) {
    if (text.length === 0) return inner;
    if (from < text.length) to = from + 1;
    else from = Math.max(0, from - 1);
  }
  if (from === to) return inner;
  const chars = toChars(spans);
  const covering = chars.slice(from, to);
  const nextOn = !covering.every((item) => item[mark]);
  for (let i = from; i < to; i++) {
    const current = chars[i];
    if (!current) continue;
    chars[i] = { ...current, [mark]: nextOn };
  }
  return serializeInlineHtml(fromChars(text, chars));
}

export function applyPlainEdit(inner: string, nextText: string, insertMarks?: InlineMarks): string {
  const spans = parseInlineHtml(inner);
  const oldText = spansToText(spans);
  if (oldText === nextText) return serializeInlineHtml(spans);
  let prefix = 0;
  while (prefix < oldText.length && prefix < nextText.length && oldText[prefix] === nextText[prefix]) {
    prefix += 1;
  }
  let oldEnd = oldText.length;
  let nextEnd = nextText.length;
  while (oldEnd > prefix && nextEnd > prefix && oldText[oldEnd - 1] === nextText[nextEnd - 1]) {
    oldEnd -= 1;
    nextEnd -= 1;
  }
  const inserted = nextText.slice(prefix, nextEnd);
  const chars = toChars(spans);
  const inherited =
    insertMarks ??
    (prefix > 0 ? chars[prefix - 1] : chars[prefix]) ??
    emptyInlineMarks();
  const nextChars = [...chars.slice(0, prefix), ...inserted.split("").map(() => ({ ...inherited })), ...chars.slice(oldEnd)];
  return serializeInlineHtml(fromChars(nextText, nextChars));
}

export function splitInnerHtml(inner: string, offset: number): { left: string; right: string } {
  const spans = parseInlineHtml(inner);
  const text = spansToText(spans);
  const at = Math.max(0, Math.min(offset, text.length));
  const chars = toChars(spans);
  return {
    left: serializeInlineHtml(fromChars(text.slice(0, at), chars.slice(0, at))),
    right: serializeInlineHtml(fromChars(text.slice(at), chars.slice(at))),
  };
}
