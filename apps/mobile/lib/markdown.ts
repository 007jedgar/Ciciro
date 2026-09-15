/**
 * A small markdown reader for Ciciro's replies.
 *
 * The editor writes ordinary prose with the occasional heading, list, or
 * emphasised phrase. That is all this parses — no tables, no HTML, no nested
 * lists — because a reply is something to read, not a document to render. It
 * returns data, so the renderer stays a dumb mapping and both stay testable.
 */

export type InlineSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
};

export type MarkdownBlock =
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "heading"; level: number; spans: InlineSpan[] }
  | { kind: "listItem"; ordered: boolean; marker: string; spans: InlineSpan[] }
  | { kind: "quote"; spans: InlineSpan[] }
  | { kind: "code"; text: string; language: string }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;
const FENCE = /^\s{0,3}(?:```|~~~)\s*(\S*)\s*$/;

/**
 * Inline emphasis, innermost-last. Each entry is a delimiter and the span flag
 * it sets; `code` wins outright because backticks suspend every other marker.
 */
const INLINE = [
  { re: /`([^`]+)`/, apply: (span: InlineSpan) => ({ ...span, code: true }) },
  {
    re: /\*\*\*([^*]+)\*\*\*/,
    apply: (span: InlineSpan) => ({ ...span, bold: true, italic: true }),
  },
  // Lazy, so a bold run can contain an italic one.
  { re: /\*\*([\s\S]+?)\*\*/, apply: (span: InlineSpan) => ({ ...span, bold: true }) },
  { re: /__([^_]+)__/, apply: (span: InlineSpan) => ({ ...span, bold: true }) },
  { re: /~~([^~]+)~~/, apply: (span: InlineSpan) => ({ ...span, strike: true }) },
  { re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/, apply: (span: InlineSpan) => ({ ...span, italic: true }) },
  { re: /(?<![_\w])_([^_\n]+)_(?!\w)/, apply: (span: InlineSpan) => ({ ...span, italic: true }) },
] as const;

const LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

function push(spans: InlineSpan[], span: InlineSpan): void {
  if (!span.text) return;
  const last = spans[spans.length - 1];
  if (
    last &&
    !last.code &&
    !span.code &&
    Boolean(last.bold) === Boolean(span.bold) &&
    Boolean(last.italic) === Boolean(span.italic) &&
    Boolean(last.strike) === Boolean(span.strike) &&
    last.href === span.href
  ) {
    last.text += span.text;
    return;
  }
  spans.push(span);
}

/** Split one line of markdown into styled runs. */
export function parseInline(text: string, inherited: InlineSpan = { text: "" }): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let rest = text;

  while (rest) {
    let best: { index: number; length: number; inner: string; span: InlineSpan } | null = null;

    const link = inherited.code ? null : rest.match(LINK);
    if (link?.index != null) {
      best = {
        index: link.index,
        length: link[0].length,
        inner: link[1] || link[2],
        span: { ...inherited, text: "", href: link[2] },
      };
    }

    if (!inherited.code) {
      for (const rule of INLINE) {
        const match = rest.match(rule.re);
        if (match?.index == null) continue;
        if (best && match.index >= best.index) continue;
        best = {
          index: match.index,
          length: match[0].length,
          inner: match[1] ?? "",
          span: rule.apply({ ...inherited, text: "" }),
        };
      }
    }

    if (!best) {
      push(spans, { ...inherited, text: rest });
      break;
    }

    push(spans, { ...inherited, text: rest.slice(0, best.index) });
    for (const span of parseInline(best.inner, best.span)) push(spans, span);
    rest = rest.slice(best.index + best.length);
  }

  return spans;
}

/** Parse a reply into renderable blocks. Blank lines separate paragraphs. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];

  function flush(): void {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ kind: "paragraph", spans: parseInline(text) });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      // An unterminated fence is normal mid-stream: take the rest as code.
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ kind: "code", text: body.join("\n"), language: fence[1] ?? "" });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        spans: parseInline(heading[2]!.replace(/\s+#+\s*$/, "").trim()),
      });
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      flush();
      blocks.push({ kind: "quote", spans: parseInline(quote[1]!.trim()) });
      continue;
    }

    const ordered = line.match(ORDERED);
    if (ordered) {
      flush();
      blocks.push({
        kind: "listItem",
        ordered: true,
        marker: `${ordered[1]}.`,
        spans: parseInline(ordered[2]!.trim()),
      });
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      flush();
      blocks.push({
        kind: "listItem",
        ordered: false,
        marker: "•",
        spans: parseInline(bullet[1]!.trim()),
      });
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

/** Plain text of a block, for accessibility labels and reveal keying. */
export function blockText(block: MarkdownBlock): string {
  if (block.kind === "rule") return "";
  if (block.kind === "code") return block.text;
  return block.spans.map((span) => span.text).join("");
}
