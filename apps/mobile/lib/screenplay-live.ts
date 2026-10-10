import { htmlToDoc } from "./manuscript";
import { SCENE_BREAK_TEXT } from "./enriched-html";
import { elementTagOfHtml, nextElementOnEnter, normalizeElement } from "./screenplay";

// The element under the caret, before the editor has flushed. The native view
// edits plain lines and cannot carry an element, so a new line (Return) has no
// element until the next flush stamps it (restampCiciroHtml), up to a second
// later. The element bar must not wait for that: this reads the same answer off
// the text the editor is showing, with the rule the flush will apply, so the
// chip is right the moment Return is pressed and the flush only confirms it.

type Committed = { text: string; tag: string };

/** What the committed chapter holds, block by block, as the editor would show it. */
function committedBlocks(html: string): Committed[] {
  return htmlToDoc(html || "<p></p>", 0).doc.blocks.map((block) => ({
    text: /^<hr\b/i.test(block.html) ? SCENE_BREAK_TEXT : block.text,
    tag: elementTagOfHtml(block.html),
  }));
}

/**
 * The element tag of each paragraph the editor shows (`live`), given the
 * committed blocks. The paragraphs both agree on at the start and the end keep
 * their tag; in between, the first one keeps the tag of the block it replaced
 * and any paragraph beyond that is a new line, which takes the element that
 * follows the one above it, as Enter does. A line with nothing above it is action.
 */
export function predictElementTags(committed: readonly Committed[], live: readonly string[]): string[] {
  const n = committed.length;
  const m = live.length;
  let head = 0;
  while (head < n && head < m && committed[head].text === live[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && committed[n - 1 - tail].text === live[m - 1 - tail]) tail++;

  const tags: string[] = [];
  for (let i = 0; i < head; i++) tags.push(committed[i].tag);
  const replaced = n - head - tail;
  for (let k = 0; k < m - head - tail; k++) {
    if (k === 0 && replaced > 0) tags.push(committed[head].tag);
    else {
      const above = tags.length > 0 ? normalizeElement(tags[tags.length - 1]) : null;
      tags.push(above ? nextElementOnEnter(above) : "action");
    }
  }
  for (let i = tail; i > 0; i--) tags.push(committed[n - i].tag);
  return tags;
}

/**
 * The element tag of the line under the caret. `liveText` is what the editor
 * shows right now (paragraphs separated by newlines), or null when it is what
 * the chapter holds; `offset` is the caret's place in it.
 */
export function elementTagAtCaret(html: string, liveText: string | null, offset: number): string {
  const blocks = committedBlocks(html);
  const paragraphs = liveText === null ? null : liveText.split("\n");
  const upTo = (text: string) => text.slice(0, Math.max(0, offset)).split("\n").length - 1;
  if (paragraphs === null || paragraphs.length === blocks.length) {
    // No line was added or removed: the element of the line the caret is on, found in the chapter.
    const at = Math.min(blocks.length - 1, paragraphs === null ? lineAt(blocks, offset) : upTo(liveText!));
    return blocks[Math.max(0, at)]?.tag ?? "action";
  }
  const tags = predictElementTags(blocks, paragraphs);
  return tags[Math.min(tags.length - 1, upTo(liveText!))] ?? "action";
}

/** The index of the committed block the offset falls in (paragraphs newline-separated). */
function lineAt(blocks: readonly Committed[], offset: number): number {
  let remaining = Math.max(0, offset);
  for (let i = 0; i < blocks.length; i++) {
    if (remaining <= blocks[i].text.length) return i;
    remaining -= blocks[i].text.length + 1;
  }
  return blocks.length - 1;
}
