import { appendParagraphsOps } from "./block-editor";
import { draftParagraphs } from "./chat-segments";
import type { SyncOp } from "./api/types";
import { htmlToDoc } from "./manuscript";

export function insertionKey(turnId: string, index: number): string {
  return `${turnId}:${index}`;
}

export function insertDraftOps(
  chapter: { id: string; content: string; revision: number },
  text: string
): SyncOp[] {
  const { doc } = htmlToDoc(chapter.content, chapter.revision);
  return appendParagraphsOps(doc, draftParagraphs(text), { actor: "ai" }).map((op) => ({
    ...op,
    chapterId: chapter.id,
  }));
}
