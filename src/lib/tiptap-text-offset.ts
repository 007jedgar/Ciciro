import type { Node as PmNode } from "@tiptap/pm/model";

// Map an offset into a block's visible text (what search reports: text nodes
// joined, a hard break as one character) to a document position, walking into
// nested paragraphs of a quote or list item. `atEnd` keeps a boundary offset in
// the node it ends rather than the one the next character starts.
export function textOffsetToPos(block: PmNode, blockPos: number, offset: number, atEnd: boolean): number {
  let remaining = Math.max(0, offset);
  let found: number | null = null;
  let last = blockPos + 1;
  block.descendants((child, pos) => {
    if (found != null) return false;
    const at = blockPos + 1 + pos;
    if (child.isText) {
      const len = child.text?.length ?? 0;
      if (remaining < len || (atEnd && remaining === len)) {
        found = at + remaining;
        return false;
      }
      remaining -= len;
      last = at + len;
    } else if (child.type.name === "hardBreak") {
      if (remaining === 0 && !atEnd) {
        found = at;
        return false;
      }
      remaining -= 1;
      last = at + 1;
    }
  });
  return found ?? last;
}

/** A block's visible text as search and comments count it: text as-is, a hard break as "\n". */
export function blockTextOf(block: PmNode): string {
  let text = "";
  block.descendants((child) => {
    if (child.isText) text += child.text ?? "";
    else if (child.type.name === "hardBreak") text += "\n";
  });
  return text;
}
