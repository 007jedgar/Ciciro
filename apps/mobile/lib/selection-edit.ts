import { escapeHtmlText, newParagraphHtml } from "./block-editor";
import { editorBlockLength, locateEditorOffset } from "./enriched-html";
import { docToHtml, htmlToDoc, newBlockId } from "./manuscript";
import type { ScreenplayElement } from "./screenplay";

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

/**
 * Swap the rest of a line, from character `from` of it, for `replacement`: what a
 * chip does to a cue or a scene heading (complete the name, add an extension, type
 * the time of day). `lineStart` is where the line starts in the editor, and
 * `expected` what the writer last saw from `from` on; if the page has moved on,
 * nothing is changed. Unlike `replaceSelectedWord` the range may be empty (the
 * replacement is added at the end of the line) and so may the replacement (the rest
 * of the line is removed). The chapter's text has no trailing space, so a line the
 * writer ended in one is read without it. Returns the new chapter HTML and the caret
 * at the end of the line.
 */
export function replaceLineTail(
  html: string,
  lineStart: number,
  from: number,
  expected: string,
  replacement: string,
): { html: string; caret: number } | null {
  const { doc } = htmlToDoc(html || "<p></p>", 0);
  const { index, start } = locateEditorOffset(doc.blocks, lineStart);
  const block = doc.blocks[index];
  if (!block || block.kind === "scene_break") return null;
  const length = block.text.length;
  const local = Math.min(from, length);
  if (block.text.slice(local) !== expected.trimEnd()) return null;
  let next: string | null;
  if (local < length) {
    next = replaceTextInBlockHtml(block.html, local, length, replacement);
  } else {
    const close = block.html.lastIndexOf("</");
    next = close < 0 ? null : block.html.slice(0, close) + escapeHtmlText(replacement) + block.html.slice(close);
  }
  if (next === null) return null;
  const blocks = [...doc.blocks];
  blocks[index] = { ...block, html: next };
  const out = docToHtml({ ...doc, blocks });
  const written = htmlToDoc(out, 0).doc.blocks[index];
  return { html: out, caret: start + (written ? editorBlockLength(written) : local + replacement.length) };
}

/**
 * A new empty line of `element` after the line holding editor offset `offset`: what
 * Tab on a cue does. Returns the new chapter HTML and the caret in the new line.
 */
export function insertLineAfter(
  html: string,
  offset: number,
  element: ScreenplayElement,
): { html: string; caret: number } | null {
  const { doc } = htmlToDoc(html || "<p></p>", 0);
  const { index, start } = locateEditorOffset(doc.blocks, offset);
  const block = doc.blocks[index];
  if (!block || block.kind === "scene_break") return null;
  const id = newBlockId();
  const added = { id, kind: "paragraph" as const, html: newParagraphHtml(id, "", element), text: "" };
  const blocks = [...doc.blocks.slice(0, index + 1), added, ...doc.blocks.slice(index + 1)];
  return { html: docToHtml({ ...doc, blocks }), caret: start + editorBlockLength(block) + 1 };
}
