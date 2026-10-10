import { htmlToDoc } from "./manuscript";
import {
  buildScriptIndex,
  completionsFor,
  continuesSpeech,
  elementTagOfHtml,
  scriptBlocksCached,
  type Completion,
  type ScriptBlock,
  type ScriptIndex,
} from "./screenplay";

// What the phone offers on the line under the caret: the same names, places and
// times as the desk's popup (the shared engine decides), shown as chips. The
// native view edits plain lines, so the line is found in the text the editor is
// showing, with the caret as an offset into it.

export type LiveLine = {
  /** Where the line starts in the editor's text. */
  start: number;
  text: string;
  /** Which line it is. */
  index: number;
  /** Whether the caret is at the end of it, where Tab and the chips act. */
  atEnd: boolean;
};

/** The line of `text` (paragraphs separated by newlines) holding editor offset `offset`. */
export function lineAtOffset(text: string, offset: number): LiveLine {
  const at = Math.max(0, offset);
  const parts = text.split("\n");
  let start = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (at <= start + part.length) return { start, text: part, index, atEnd: at === start + part.length };
    start += part.length + 1;
  }
  const last = parts[parts.length - 1] ?? "";
  return { start: start - last.length - 1, text: last, index: parts.length - 1, atEnd: true };
}

/** The chapter's blocks as the engine reads them, with the block of the line being typed left out. */
function otherLines(html: string, skip: number, liveCount: number): ScriptBlock[] {
  const blocks = htmlToDoc(html || "<p></p>", 0).doc.blocks.map((block) => ({
    element: elementTagOfHtml(block.html),
    text: block.text,
  }));
  // The committed lines lag the live ones; the line under the caret is only dropped when they line up.
  return blocks.length === liveCount ? blocks.filter((_, i) => i !== skip) : blocks;
}

export type LineContext = {
  /** The other sequences' content, in order. */
  others: readonly string[];
  /** The open sequence's committed content. */
  html: string;
  /** The names in the story bible. */
  names: readonly string[];
  language?: string | null;
  /** Whether the extensions (V.O., O.S., CONT'D) can be written in the app's language; false keeps CONT'D out. */
  extensions?: boolean;
};

/**
 * The chips for the line the caret is on, when it is a cue or a scene heading
 * with the caret at the end of it. `element` is the line's element (the bar's
 * live answer), and `liveLines` the lines the editor shows now.
 */
export function chipsForLine(
  element: string,
  line: LiveLine,
  liveLines: readonly string[],
  context: LineContext
): Completion[] {
  if (!line.atEnd || (element !== "character" && element !== "scene-heading")) return [];
  const index: ScriptIndex = buildScriptIndex(
    [...context.others.map((html) => scriptBlocksCached(html)), otherLines(context.html, line.index, liveLines.length)],
    { names: context.names }
  );
  const mine = htmlToDoc(context.html || "<p></p>", 0).doc.blocks.map((block) => ({
    element: elementTagOfHtml(block.html),
    text: block.text,
  }));
  const items = completionsFor(element, line.text, index, {
    language: context.language,
    whenEmpty: true,
    trailing: false,
    limit: 12,
    // The committed blocks lag the live lines; CONT'D is only judged when they line up.
    continues:
      context.extensions === false || mine.length !== liveLines.length
        ? undefined
        : (name) => continuesSpeech(mine, line.index, name),
  });
  // A chip that would change nothing is not worth a tap.
  return items.filter((item) => line.text.slice(0, item.from) + item.insert !== line.text);
}
