import {
  cellPad,
  estimatePages,
  scriptBlocksFromHtml,
  typesetSequences,
  type PageOptions,
  type PageRow,
} from "./screenplay";

// A script as pages, for the phone's page view. The rows come from the shared
// typeset (screenplay.ts, mirrored from the web), the same one the screenplay
// PDF draws, so a page here is the page the editor's soft rules, the page
// count and the printed script all agree on: dual-dialogue columns, the
// `(MORE)` and `(CONT'D)` notes and scene numbers included. Nothing here
// decides where a line or a page ends: this only sets each row in a monospace
// line and stitches the answer into pages.

/** One line of a page, ready to set in a monospace face: already indented to its column. */
export type ScriptLine = {
  /** The row as one string. A dual-dialogue row has both columns on it, the right one padded out to its own. */
  text: string;
  /** The scene heading is bold. */
  bold: boolean;
  /** Which sequence it belongs to (an index into the chapters given). */
  sequence: number;
  /** A note the engine added itself (`(MORE)`, or the cue again with `(CONT'D)`); its text is in no block. */
  synthetic?: "more" | "contd";
  /** The scene's number, on the first line of a numbered scene heading. */
  sceneNumber?: string;
} | null; // null: a blank line

export type ScriptPage = {
  /** The page number as printed. */
  number: number;
  lines: ScriptLine[];
};

export type ScriptPages = {
  pages: ScriptPage[];
  /** The page each sequence begins on (an empty sequence begins where the last ended). */
  sequenceStarts: number[];
  /** How many pages the script runs; 0 for a script with nothing typed. */
  total: number;
};

/** Whether any sequence has a word in it. A new script's lone empty scene heading is not a page. */
function hasText(chapters: readonly string[]): boolean {
  return chapters.some((html) => scriptBlocksFromHtml(html).some((block) => block.text.trim()));
}

/** How many pages a script runs, 0 until something is typed. */
export function scriptPageCount(chapters: readonly string[], opts: PageOptions = {}): number {
  return hasText(chapters) ? estimatePages(chapters, opts) : 0;
}

/** A typeset row as one monospace line: each cell at its column, a dual row's right cell after its left. */
function setRow(row: NonNullable<PageRow>): string {
  let text = " ".repeat(Math.max(0, cellPad(row))) + row.text;
  if (row.right) text = text.padEnd(Math.max(0, cellPad(row.right))) + row.right.text;
  return text;
}

/**
 * The script's sequences, in order, as printed pages with continuous numbers.
 * `opts` are the script's page settings (`pageOptionsOf(parseScriptSettings(...))`):
 * they move the page breaks, so the pages and the count both take them.
 */
export function scriptPages(chapters: readonly string[], opts: PageOptions = {}): ScriptPages {
  if (!hasText(chapters)) return { pages: [], sequenceStarts: chapters.map(() => 1), total: 0 };

  const set = typesetSequences(chapters.map(scriptBlocksFromHtml), opts);
  const pages: ScriptPage[] = set.pages.map((rows, index) => ({
    number: index + 1,
    lines: rows.map((row): ScriptLine => {
      if (!row) return null;
      return {
        text: setRow(row),
        bold: row.bold,
        sequence: row.sequence,
        ...(row.synthetic ? { synthetic: row.synthetic } : {}),
        ...(row.sceneNumber ? { sceneNumber: row.sceneNumber } : {}),
      };
    }),
  }));

  // A sequence begins on the page of its first row; one with nothing in it begins
  // where the sequences before it ended.
  const first: number[] = [];
  const last: number[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      if (!line) continue;
      first[line.sequence] ??= page.number;
      last[line.sequence] = page.number;
    }
  }
  const sequenceStarts: number[] = [];
  let reached = 1;
  for (let sequence = 0; sequence < chapters.length; sequence++) {
    sequenceStarts.push(first[sequence] ?? reached);
    reached = Math.max(reached, last[sequence] ?? reached);
  }

  return { pages, sequenceStarts, total: set.count };
}
