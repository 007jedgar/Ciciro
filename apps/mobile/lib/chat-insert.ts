import { appendParagraphsOps } from "./block-editor";
import { draftParagraphs } from "./chat-segments";
import type { SyncOp } from "./api/types";
import { htmlToDoc } from "./manuscript";
import { classifyScreenplayLines, elementOfHtml, type ManuscriptKind } from "./manuscript-kind";

export function insertionKey(turnId: string, index: number): string {
  return `${turnId}:${index}`;
}

/**
 * Ops that append a Ciciro draft to a chapter. A screenplay's draft is sorted
 * into elements line by line, read on from the element of the block it lands
 * after, so a draft that opens under a cue starts as dialogue.
 */
export function insertDraftOps(
  chapter: { id: string; content: string; revision: number },
  text: string,
  kind?: ManuscriptKind
): SyncOp[] {
  const { doc } = htmlToDoc(chapter.content, chapter.revision);
  const last = doc.blocks[doc.blocks.length - 1];
  const paragraphs =
    kind === "screenplay"
      ? classifyScreenplayLines(text, last ? elementOfHtml(last.html) : undefined)
      : draftParagraphs(text);
  return appendParagraphsOps(doc, paragraphs, { actor: "ai" }).map((op) => ({
    ...op,
    chapterId: chapter.id,
  }));
}
