// Short craft-flavored status lines for the chat tool trace.
// Keyed by tool/action name - not by which model ran - so the wire shape stays
// `{type:"tool", v:string}` and Ciciro remains the only named interlocutor.

const READING = [
  "turning a page",
  "checking the stacks",
  "reading the parchment",
  "tracing a thread",
  "looking into things",
];

const WRITING = [
  "ink on the page",
  "working the draft",
  "sharpening a line",
  "setting the type",
];

const GATHERING = [
  "gathering the pages",
  "folding earlier notes",
  "tidying the desk",
  "compacting the stack",
];

const SEARCHING = [
  "highlighting themes",
  "scanning the manuscript",
  "hunting a phrase",
];

const MOVING = [
  "moving things around",
  "reordering the pages",
  "shifting a passage",
];

const RECORDING = [
  "noting it in the margins",
  "recording to the bible",
  "marking the canon",
];

const DEFAULT = [
  "at the desk",
  "working quietly",
];

function pick(lines: string[], salt = ""): string {
  if (!lines.length) return "working";
  let h = 0;
  for (let i = 0; i < salt.length; i++) h = (h * 31 + salt.charCodeAt(i)) >>> 0;
  h ^= Date.now() & 0xffff;
  return lines[h % lines.length];
}

/** Map a tool or backstage action name to a short status line for the author. */
export function backstageLine(
  action: string,
  detail?: string
): string {
  const a = action.toLowerCase();
  let line: string;

  if (
    a === "compact" ||
    a === "summarize" ||
    a.includes("compact") ||
    a.includes("gather")
  ) {
    line = pick(GATHERING, a + (detail || ""));
  } else if (
    a === "dispatch_draft" ||
    a === "draft" ||
    a.includes("draft")
  ) {
    line = pick(WRITING, a + (detail || ""));
  } else if (
    a === "search_manuscript" ||
    a === "search_chat" ||
    a.includes("search")
  ) {
    line = pick(SEARCHING, detail || a);
  } else if (
    a === "read_chapter" ||
    a === "read_bible" ||
    a === "read_blob" ||
    a === "read_past_turn" ||
    a === "list_bible" ||
    a.includes("read")
  ) {
    line = pick(READING, detail || a);
  } else if (
    a === "move_text" ||
    a === "insert_text" ||
    a === "edit_manuscript" ||
    a.includes("move") ||
    a.includes("insert")
  ) {
    line = pick(MOVING, a);
  } else if (
    a === "append_canon" ||
    a === "update_bible" ||
    a.includes("canon") ||
    a.includes("bible")
  ) {
    line = pick(RECORDING, a);
  } else {
    line = pick(DEFAULT, a);
  }

  if (detail && (a === "read_chapter" || a === "read_bible" || a === "search_manuscript")) {
    return `${line} · ${detail}`;
  }
  return line;
}
