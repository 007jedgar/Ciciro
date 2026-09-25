// Turn a chapter's TipTap HTML into a small, format-neutral block model that
// the EPUB and PDF writers share. Only the structure a book needs survives:
// paragraphs, headings, block quotes, list items, scene breaks, and bold or
// italic runs inside them.

export type Run = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { type: "paragraph"; runs: Run[] }
  | { type: "heading"; level: 1 | 2 | 3; runs: Run[] }
  | { type: "quote"; runs: Run[] }
  | { type: "list-item"; list: number; ordered: boolean; marker: string; runs: Run[] }
  | { type: "break" };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const TOKEN = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>|([^<]+)|</gi;

function pushRun(runs: Run[], text: string, bold: boolean, italic: boolean) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && !!last.bold === bold && !!last.italic === italic) {
    last.text += text;
    return;
  }
  const run: Run = { text };
  if (bold) run.bold = true;
  if (italic) run.italic = true;
  runs.push(run);
}

function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && !out[0].text.replace(/^\s+/, "")) out.shift();
  while (out.length && !out[out.length - 1].text.replace(/\s+$/, "")) out.pop();
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out;
}

export function runsText(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

const SCENE_BREAK = /^(?:[#*]{1,3}|\*\s\*\s\*|[-—_]{3,}|⁂)$/;

export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  if (!html) return blocks;

  let runs: Run[] = [];
  let bold = 0;
  let italic = 0;
  type Kind = "paragraph" | "heading" | "quote" | "list-item";
  let kind = "paragraph" as Kind;
  let level: 1 | 2 | 3 = 2;
  let inQuote = 0;
  const lists: { id: number; ordered: boolean; count: number }[] = [];
  let listCount = 0;
  let item = { list: 0, ordered: false, marker: "•" };

  function flush() {
    const trimmed = trimRuns(runs);
    runs = [];
    if (!trimmed.length) return;
    const text = runsText(trimmed).trim();
    if (kind === "paragraph" && SCENE_BREAK.test(text)) {
      blocks.push({ type: "break" });
      return;
    }
    if (kind === "heading") blocks.push({ type: "heading", level, runs: trimmed });
    else if (kind === "list-item") blocks.push({ type: "list-item", ...item, runs: trimmed });
    else if (kind === "quote") blocks.push({ type: "quote", runs: trimmed });
    else blocks.push({ type: "paragraph", runs: trimmed });
  }

  function open(next: Kind) {
    flush();
    kind = inQuote && next === "paragraph" ? "quote" : next;
  }

  function close() {
    flush();
    kind = inQuote ? "quote" : "paragraph";
  }

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(html))) {
    const [, closing, rawTag, , text] = match;
    if (text !== undefined) {
      pushRun(runs, decodeEntities(text.replace(/\s+/g, " ")), bold > 0, italic > 0);
      continue;
    }
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();
    const isClose = closing === "/";
    switch (tag) {
      case "strong":
      case "b":
        bold = Math.max(0, bold + (isClose ? -1 : 1));
        break;
      case "em":
      case "i":
        italic = Math.max(0, italic + (isClose ? -1 : 1));
        break;
      case "br":
        pushRun(runs, "\n", bold > 0, italic > 0);
        break;
      case "hr":
        flush();
        blocks.push({ type: "break" });
        break;
      case "p":
      case "div":
        if (isClose) close();
        else open(kind === "list-item" ? "list-item" : "paragraph");
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        if (isClose) close();
        else {
          open("heading");
          level = Math.min(3, Math.max(1, Number(tag[1]))) as 1 | 2 | 3;
        }
        break;
      case "blockquote":
        flush();
        inQuote = Math.max(0, inQuote + (isClose ? -1 : 1));
        kind = inQuote ? "quote" : "paragraph";
        break;
      case "ul":
      case "ol":
        flush();
        if (isClose) lists.pop();
        else lists.push({ id: ++listCount, ordered: tag === "ol", count: 0 });
        kind = inQuote ? "quote" : "paragraph";
        break;
      case "li":
        if (isClose) close();
        else {
          const list = lists[lists.length - 1];
          if (list) list.count += 1;
          item = {
            list: list?.id ?? 0,
            ordered: !!list?.ordered,
            marker: list?.ordered ? `${list.count}.` : "•",
          };
          open("list-item");
        }
        break;
      default:
        break;
    }
  }
  flush();
  return blocks;
}
