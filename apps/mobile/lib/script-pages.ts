import {
  PAGE_LINES,
  SCRIPT_START,
  estimatePages,
  layoutHtml,
  paginate,
  scriptBlocksFromHtml,
  type LaidOutBlock,
  type PageCursor,
} from "./screenplay";

// A script as pages, for the phone's page view. The lines come from the shared
// layout and the page breaks from the shared paginate (screenplay.ts, mirrored
// from the web), so a page here is the page the editor's soft rules, the
// "about N pages" count and the printed script all agree on. Nothing here
// decides where a line or a page ends: this only stitches the engine's answer
// into pages, carrying a page across the end of one sequence into the next.

/** One line of a page, ready to set in a monospace face: already indented to its column. */
export type ScriptLine = {
  text: string;
  /** The scene heading is bold. */
  bold: boolean;
  /** Which sequence it belongs to (an index into the chapters given). */
  sequence: number;
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
  /** About how many pages the script runs; 0 for a script with nothing typed. */
  total: number;
};

/** Whether any sequence has a word in it. A new script's lone empty scene heading is not a page. */
function hasText(chapters: readonly string[]): boolean {
  return chapters.some((html) => scriptBlocksFromHtml(html).some((block) => block.text.trim()));
}

/** About how many pages a script runs, 0 until something is typed. */
export function scriptPageCount(chapters: readonly string[]): number {
  return hasText(chapters) ? estimatePages(chapters) : 0;
}

/** A laid-out line as it sits on the page: padded to its column, flush right for a transition. */
function setLine(block: LaidOutBlock, text: string): string {
  const pad = block.align === "right" ? block.indent + block.width - text.length : block.indent;
  return " ".repeat(Math.max(0, pad)) + text;
}

/** The script's sequences, in order, as printed pages with continuous numbers. */
export function scriptPages(chapters: readonly string[]): ScriptPages {
  const pages: ScriptPage[] = [];
  const sequenceStarts: number[] = [];
  let cursor: PageCursor = SCRIPT_START;
  let page: ScriptPage | null = null;

  for (let sequence = 0; sequence < chapters.length; sequence++) {
    const laid = layoutHtml(chapters[sequence]);
    const { breaks, end } = paginate(laid, { start: cursor });
    const opening = breaks.find((b) => b.block === 0 && b.line === 0);
    sequenceStarts.push(opening ? opening.page : cursor.page);
    let nextBreak = 0;
    for (const block of laid) {
      for (let at = 0; at < block.lines.length; at++) {
        const brk = breaks[nextBreak];
        if (brk && brk.block === block.index && brk.line === at) {
          page = { number: brk.page, lines: [] };
          pages.push(page);
          nextBreak++;
        }
        if (!page) {
          page = { number: cursor.page, lines: [] };
          pages.push(page);
        }
        // The blank lines above a block drop away at the top of a page, as in paginate.
        if (at === 0 && page.lines.length > 0) for (let k = 0; k < block.before; k++) page.lines.push(null);
        page.lines.push({ text: setLine(block, block.lines[at].text), bold: block.bold, sequence });
      }
    }
    cursor = end;
  }

  return { pages, sequenceStarts, total: hasText(chapters) ? estimatePages(chapters) : 0 };
}

/** Lines in a full page, for sizing a sheet. */
export const SHEET_LINES = PAGE_LINES;
