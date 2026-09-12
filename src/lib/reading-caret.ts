import { htmlToDoc } from "@/lib/manuscript";
import { htmlToText } from "@/lib/text";

export type ReadingCaret = {
  chapterId: string;
  blockId: string;
  offset: number;
};

/** Clamp a caret offset to the visible text of a block. */
export function clampBlockOffset(text: string, offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.min(Math.floor(offset), text.length);
}

export function blockTextById(html: string, blockId: string): string | null {
  const { doc } = htmlToDoc(html, 0);
  const block = doc.blocks.find((b) => b.id === blockId);
  return block ? block.text : null;
}

/**
 * Map a sentence-level caret (block + offset) onto the chapter's plain text
 * so a read-only view can scroll to the same sentence.
 */
export function resumePlainTextIndex(
  html: string,
  blockId: string,
  offset: number
): number | null {
  const { doc } = htmlToDoc(html, 0);
  let index = 0;
  for (let i = 0; i < doc.blocks.length; i++) {
    const block = doc.blocks[i];
    if (block.id === blockId) {
      return index + clampBlockOffset(block.text, offset);
    }
    index += block.text.length;
    if (i < doc.blocks.length - 1) index += 2;
  }
  return null;
}

export function caretLabel(caret: Pick<ReadingCaret, "blockId" | "offset">): string {
  return `${caret.blockId}:${caret.offset}`;
}

export function htmlToPlainBlocks(html: string): { id: string; text: string }[] {
  const { doc } = htmlToDoc(html, 0);
  return doc.blocks.map((b) => ({ id: b.id, text: b.text || htmlToText(b.html) }));
}
