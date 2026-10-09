import { escapeHtmlText } from "./block-editor";
import { locateEditorOffset } from "./enriched-html";
import { docToHtml, htmlToDoc } from "./manuscript";

/**
 * `html` with the characters `[from, to)` of its text swapped for
 * `replacement`. Offsets count text the way the editor does: an entity is one
 * character, a run of whitespace is one and a `<br>` is one. The replacement
 * lands inside whatever marks wrapped the first replaced character, so a bold
 * word stays bold; tags around and between the replaced characters are kept.
 * Null when the range is outside the text.
 */
function replaceTextInBlockHtml(
  html: string,
  from: number,
  to: number,
  replacement: string,
): string | null {
  const open = html.indexOf(">") + 1;
  let out = html.slice(0, open);
  let count = 0;
  let placed = false;
  let i = open;
  const place = () => {
    if (!placed) out += escapeHtmlText(replacement);
    placed = true;
  };
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      const stop = end < 0 ? html.length : end + 1;
      const tag = html.slice(i, stop);
      i = stop;
      if (/^<br\b/i.test(tag)) {
        if (count >= from && count < to) place();
        else out += tag;
        count += 1;
      } else {
        out += tag;
      }
      continue;
    }
    let unit = html[i];
    if (unit === "&") {
      const semi = html.indexOf(";", i);
      unit = html.slice(i, semi > 0 && semi - i <= 8 ? semi + 1 : i + 1);
    } else if (/\s/.test(unit)) {
      let j = i;
      while (j < html.length && /\s/.test(html[j])) j += 1;
      unit = html.slice(i, j);
    }
    i += unit.length;
    if (count >= from && count < to) place();
    else out += unit;
    count += 1;
  }
  return placed ? out : null;
}

/**
 * Swap the word at editor offsets `[start, end)` for `replacement`, as the
 * writer would by typing over it. `expected` is the word the menu offered
 * synonyms for: if it is no longer there (the page changed while the lookup
 * ran) nothing is replaced. Returns the new chapter HTML and the caret just
 * after the new word.
 */
export function replaceSelectedWord(
  html: string,
  start: number,
  end: number,
  expected: string,
  replacement: string,
): { html: string; caret: number } | null {
  if (end <= start || !replacement) return null;
  const { doc } = htmlToDoc(html || "<p></p>", 0);
  const { index, local, start: blockStart } = locateEditorOffset(doc.blocks, start);
  const block = doc.blocks[index];
  if (!block || block.kind === "scene_break") return null;
  const to = local + (end - start);
  if (block.text.slice(local, to) !== expected) return null;
  const next = replaceTextInBlockHtml(block.html, local, to, replacement);
  if (next === null) return null;
  const blocks = [...doc.blocks];
  blocks[index] = { ...block, html: next };
  return {
    html: docToHtml({ ...doc, blocks }),
    caret: blockStart + local + replacement.length,
  };
}
