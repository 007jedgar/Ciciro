import { elementTagOfHtml, scriptDisplayText, type ManuscriptKind } from "@/lib/manuscript-kind";
import { findBlockRun } from "@/lib/passages";

// An edit_manuscript find/replace on a script, squared with how the script is
// stored. The assistant reads a script as marked lines (script-view.ts), so it
// can hand back a replace with a line mark or a parenthetical in its brackets.
// Neither is stored text: a mark only means something when a whole line is
// replaced, and a parenthetical is stored bare (the page draws the brackets).
// A find is always matched as written.

const BRACKETED = /^\(\s*(\S.*?)\s*\)$/;

/**
 * The replace to apply for this find. A replace for part of a line loses its
 * marks: the line keeps its element, and a mark would otherwise be stored as
 * text. A bracketed replace for a whole parenthetical loses its brackets.
 */
export function scriptEdit(
  html: string,
  edit: { find: string; replace: string },
  kind: ManuscriptKind
): { find: string; replace: string } {
  if (kind !== "screenplay") return edit;
  const { find, replace } = edit;
  const run = findBlockRun(html, find);
  if (!run) return { find, replace: scriptDisplayText(replace) };
  const bare = replace.trim().match(BRACKETED)?.[1];
  if (bare !== undefined && run.startIdx === run.endIdx && elementTagOfHtml(html.slice(run.start, run.end)) === "parenthetical") {
    return { find, replace: bare };
  }
  return edit;
}

/** For a script find that did not match: a note when it carries a parenthetical's brackets, which are never stored. */
export function bracketedFindHint(find: string, kind: ManuscriptKind): string {
  if (kind !== "screenplay" || !find.split("\n").some((line) => BRACKETED.test(line.trim()))) return "";
  return " A parenthetical's brackets are shown for reading only and are not stored: find its words without them.";
}
