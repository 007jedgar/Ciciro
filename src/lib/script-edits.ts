import { elementTagOfHtml, scriptDisplayText, type ManuscriptKind } from "@/lib/manuscript-kind";
import { findBlockRun, getBlocks, normalizeWhitespace } from "@/lib/passages";

// An edit_manuscript find/replace on a script, squared with how the script is
// stored. The assistant reads a script as marked lines (script-view.ts), so it
// can hand back a parenthetical in its brackets or a replace with a line mark.
// Neither is stored text: a parenthetical is stored bare (the page draws the
// brackets), and a mark only means something when a whole line is replaced.

const BRACKETED = /^\(\s*(\S.*?)\s*\)$/;

function parentheticalBlock(html: string, text: string): boolean {
  const run = findBlockRun(html, text);
  return run !== null && run.startIdx === run.endIdx && elementTagOfHtml(html.slice(run.start, run.end)) === "parenthetical";
}

function appears(html: string, find: string): boolean {
  if (findBlockRun(html, find)) return true;
  const needle = normalizeWhitespace(find);
  return needle !== "" && getBlocks(html).some((block) => block.text.includes(needle));
}

export type ScriptEdit = {
  find: string;
  replace: string;
  /** The find is a whole block, to be replaced as one and never as words inside other lines. */
  wholeBlocks?: true;
};

/**
 * The find and replace to apply to this chapter. A find copied from the view
 * as a bracketed parenthetical is matched against a whole parenthetical block
 * without its brackets, and replaces that block. A replace for part of a line
 * loses its marks: the line keeps its element, and a mark would otherwise be
 * stored as text.
 */
export function scriptEdit(
  html: string,
  edit: { find: string; replace: string },
  kind: ManuscriptKind
): ScriptEdit {
  if (kind !== "screenplay") return edit;
  const { find, replace } = edit;
  const bare = find.trim().match(BRACKETED)?.[1];
  if (bare !== undefined && !appears(html, find) && parentheticalBlock(html, bare)) {
    const line = replace.trim();
    const bracketed = /\n/.test(line) || BRACKETED.test(line) || !line ? replace : `(${line})`;
    return { find: bare, replace: bracketed, wholeBlocks: true };
  }
  if (!findBlockRun(html, find)) return { find, replace: scriptDisplayText(replace) };
  return { find, replace };
}
