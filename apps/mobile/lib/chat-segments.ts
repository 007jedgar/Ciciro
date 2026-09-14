export type ChatSegment =
  | { kind: "md"; text: string }
  | { kind: "draft"; text: string; open: boolean };

const OPEN = "<draft>";
const CLOSE = "</draft>";

/** Split a Ciciro reply into markdown prose and <draft> blocks. */
export function parseChatSegments(content: string): ChatSegment[] {
  const segs: ChatSegment[] = [];
  let i = 0;
  while (i < content.length) {
    const start = content.indexOf(OPEN, i);
    if (start === -1) {
      segs.push({ kind: "md", text: content.slice(i) });
      break;
    }
    if (start > i) segs.push({ kind: "md", text: content.slice(i, start) });
    const from = start + OPEN.length;
    const end = content.indexOf(CLOSE, from);
    if (end === -1) {
      segs.push({ kind: "draft", text: content.slice(from), open: true });
      break;
    }
    segs.push({ kind: "draft", text: content.slice(from, end), open: false });
    i = end + CLOSE.length;
  }
  return segs;
}

export function closeOpenDrafts(content: string): string {
  const segs = parseChatSegments(content);
  if (!segs.some((seg) => seg.kind === "draft" && seg.open)) return content;
  return content + CLOSE;
}

export function draftParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}
