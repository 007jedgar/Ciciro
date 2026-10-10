import { ELEMENT_MARK } from "@/lib/manuscript-kind";
import { normalizeElement, scriptBlocksFromHtml, type ScreenplayElement, type ScriptBlock } from "@/lib/screenplay";

// A screenplay as the assistant reads it: marked script lines, the same format
// it is asked to write (SCRIPT_FORMAT in manuscript-kind.ts, read back by
// parseScriptLines). The model has no use for HTML, and flattened text loses the
// one thing a script is made of: which line is a cue, which is dialogue, which
// is action. Text is shown as stored. Capitals are applied when the page is
// drawn, so a heading typed in lowercase reads as typed, and the model's finds
// match the stored words exactly.

const SPEECH: ReadonlySet<ScreenplayElement> = new Set(["character", "parenthetical", "dialogue"]);

function lineOf(element: ScreenplayElement, text: string): string {
  if (element === "parenthetical") return /^\(.*\)$/.test(text) ? text : `(${text})`;
  if (element === "centered") return `>${text}<`;
  return `${ELEMENT_MARK[element] ?? ""}${text}`;
}

/**
 * Blocks as marked script lines: a blank line between blocks, none inside a
 * speech (a cue, its parentheticals and its dialogue read as one run). A block
 * with no text is left out.
 */
export function scriptTextOfBlocks(blocks: readonly ScriptBlock[]): string {
  let out = "";
  let above: ScreenplayElement | null = null;
  for (const block of blocks) {
    const text = block.text.replace(/\s*\n\s*/g, " ").trim();
    if (!text) continue;
    // A tag this build does not know reads as action; it is only the model's view.
    const element = normalizeElement(block.element);
    const joins = above !== null && SPEECH.has(above) && (element === "parenthetical" || element === "dialogue");
    if (above !== null) out += joins ? "\n" : "\n\n";
    out += lineOf(element, text);
    above = element;
  }
  return out;
}

/** A chapter's block HTML as marked script lines. Pending suggestions are text by now (chapterHtmlForModel). */
export function scriptTextOfHtml(html: string): string {
  return scriptTextOfBlocks(scriptBlocksFromHtml(html));
}

/** The last `count` non-empty blocks of a chapter as marked script lines: where a continuation picks up. */
export function scriptTail(html: string, count = 10): string {
  return scriptTextOfBlocks(
    scriptBlocksFromHtml(html)
      .filter((block) => block.text.trim())
      .slice(-count)
  );
}

/** The element of the last block with text, or undefined for an empty chapter. */
export function lastScriptElement(html: string): ScreenplayElement | undefined {
  const blocks = scriptBlocksFromHtml(html).filter((block) => block.text.trim());
  const last = blocks[blocks.length - 1];
  return last ? normalizeElement(last.element) : undefined;
}
