import { htmlToDoc, type ManuscriptBlock } from "./manuscript";
import { SCENE_BREAK_TEXT, assignIds, blockAtPlainOffset } from "./enriched-html";
import { elementTagOfHtml, nextElementOnEnter, normalizeElement } from "./screenplay";

// The element under the caret, before the editor has flushed. The native view
// edits plain lines and cannot carry an element, so a new line (Return) has no
// element until the next flush stamps it (restampCiciroHtml), up to a second
// later. The element bar must not wait for that: this reads the same answer off
// the text the editor is showing, with the rule the flush will apply, so the
// chip is right the moment Return is pressed and the flush only confirms it.

type Committed = { text: string; tag: string; id?: string; kind?: ManuscriptBlock["kind"] };

/** What the committed chapter holds, block by block, as the editor would show it. */
function committedBlocks(html: string): Committed[] {
  return htmlToDoc(html || "<p></p>", 0).doc.blocks.map((block) => ({
    id: block.id,
    kind: block.kind,
    text: /^<hr\b/i.test(block.html) ? SCENE_BREAK_TEXT : block.text,
    tag: elementTagOfHtml(block.html),
  }));
}

/**
 * The element tag of each paragraph the editor shows (`live`), given the
 * committed blocks, by the rule the flush will apply (restampCiciroHtml, which
 * matches blocks with assignIds): a paragraph that is a committed block keeps
 * its tag, and a new one takes the element that follows the one above it, as
 * Enter does. A line with nothing above it is action.
 */
export function predictElementTags(committed: readonly Committed[], live: readonly string[]): string[] {
  const old: ManuscriptBlock[] = committed.map((block, index) => ({
    id: block.id ?? `old-${index}`,
    kind: block.kind ?? "paragraph",
    html: "",
    text: block.text,
  }));
  const next: ManuscriptBlock[] = live.map((text, index) => ({
    id: `new-${index}`,
    kind: text === SCENE_BREAK_TEXT ? "scene_break" : "paragraph",
    html: "",
    text,
  }));
  const byId = new Map(old.map((block, index) => [block.id, committed[index].tag]));
  const tags: string[] = [];
  assignIds(old, next).forEach((id, index) => {
    const kept = byId.get(id);
    if (kept !== undefined) tags.push(kept);
    else {
      const above = index > 0 ? normalizeElement(tags[index - 1]) : null;
      tags.push(above ? nextElementOnEnter(above) : "action");
    }
  });
  return tags;
}

/**
 * The element tag of the line under the caret. `liveText` is what the editor
 * shows right now (paragraphs separated by newlines), or null when it is what
 * the chapter holds; `offset` is the caret's place in it.
 *
 * The editor's HTML leaves out one trailing blank line (`X\n` reads back as
 * just `X`), so the blank line Return adds at the end is not in the chapter
 * until something is typed into it. The flush sees the paragraphs without it,
 * and so does this: the blank takes the element the chapter's own empty last
 * block was given (the author picked one for it), else the one that follows
 * the last line.
 */
export function elementTagAtCaret(html: string, liveText: string | null, offset: number): string {
  const blocks = committedBlocks(html);
  if (blocks.length === 0) return "action";
  const last = blocks[blocks.length - 1];
  const lineOf = (text: string) => text.slice(0, Math.max(0, offset)).split("\n").length - 1;

  if (liveText === null) {
    const text = blocks.map((block) => block.text).join("\n");
    if (offset > text.length) return nextElementOnEnter(normalizeElement(last.tag));
    return blocks[Math.min(blocks.length - 1, lineOf(text))].tag;
  }

  const paragraphs = liveText.split("\n");
  const body = paragraphs.length > 1 && paragraphs[paragraphs.length - 1] === "" ? paragraphs.slice(0, -1) : paragraphs;
  const tags = predictElementTags(blocks, body);
  if (offset > body.join("\n").length) {
    if (last.text === "" && body.length === blocks.length - 1) return last.tag;
    return nextElementOnEnter(normalizeElement(tags[tags.length - 1]));
  }
  return tags[Math.min(tags.length - 1, lineOf(liveText))];
}

/**
 * The block an element chip should change: the one the caret is in, found in
 * `html` (the chapter after a flush). `fallback` is the block id from the last
 * caret move, which is stale when Return has added a line since: it names the
 * line above, and a chip tapped on the new empty line would retag that one.
 */
export function elementTargetId(html: string, docOffset: number, fallback: string): string {
  return blockAtPlainOffset(html, docOffset)?.blockId || fallback;
}

/**
 * Whether the caret is past the end of everything the chapter holds: on a blank
 * line the editor shows and the chapter does not have (yet).
 */
export function caretBeyondChapter(html: string, docOffset: number): boolean {
  const blocks = committedBlocks(html);
  return docOffset > blocks.map((block) => block.text).join("\n").length;
}
