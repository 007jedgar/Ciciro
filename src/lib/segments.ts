// Shared draft/markdown segment parsing for chat UI and model-view stubbing.

export type Segment =
  | { kind: "md"; text: string }
  | { kind: "draft"; text: string; open: boolean };

/** Split a reply into markdown prose and <draft>...</draft> blocks. */
export function parseSegments(content: string): Segment[] {
  const OPEN = "<draft>";
  const CLOSE = "</draft>";
  const segs: Segment[] = [];
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

/** Rebuild content from segments (used after stubbing draft bodies). */
export function joinSegments(segs: Segment[]): string {
  return segs
    .map((s) => {
      if (s.kind === "md") return s.text;
      if (s.open) return `<draft>${s.text}`;
      return `<draft>${s.text}</draft>`;
    })
    .join("");
}
