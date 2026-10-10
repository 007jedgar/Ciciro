import { scriptDisplayText, type ManuscriptKind } from "@/lib/manuscript-kind";
import { findBlockRun, getBlocks, normalizeWhitespace } from "@/lib/passages";

// An edit_manuscript find/replace on a script, squared with how the script is
// stored. The assistant reads a script as marked lines (script-view.ts), so it
// can hand back a parenthetical in its brackets or a replace with a line mark.
// Neither is stored text: a parenthetical is stored bare (the page draws the
// brackets), and a mark only means something when a whole line is replaced.

const BRACKETED = /^\(\s*(\S.*?)\s*\)$/;

function unbracket(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim().match(BRACKETED)?.[1] ?? line)
    .join("\n");
}

function appears(html: string, find: string): boolean {
  if (findBlockRun(html, find)) return true;
  const needle = normalizeWhitespace(find);
  return needle !== "" && getBlocks(html).some((block) => block.text.includes(needle));
}

/**
 * The find and replace to apply to this chapter. A find copied from the view
 * with a parenthetical's brackets is matched without them, and so is its
 * replace. A replace for part of a line loses its marks: the line keeps its
 * element, and a mark would otherwise be stored as text.
 */
export function scriptEdit(
  html: string,
  edit: { find: string; replace: string },
  kind: ManuscriptKind
): { find: string; replace: string } {
  if (kind !== "screenplay") return edit;
  let { find, replace } = edit;
  if (!appears(html, find)) {
    const bare = unbracket(find);
    if (bare !== find && appears(html, bare)) {
      find = bare;
      replace = unbracket(replace);
    }
  }
  if (!findBlockRun(html, find)) replace = scriptDisplayText(replace);
  return { find, replace };
}
