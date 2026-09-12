import { htmlToPlainText } from "./html";
import { applyOp, countWords, docToHtml, htmlToDoc } from "./manuscript";
import type { ManuscriptOp } from "./manuscript";
import type { ChapterSnapshot } from "./db";

export type RemoteChapterOp = ManuscriptOp & {
  chapterId: string;
  seq: number;
};

export type RejectedRemoteOp = {
  op: ManuscriptOp;
  reason: "stale" | "missing_block";
  chapter: Pick<ChapterSnapshot, "id" | "projectId" | "content" | "revision" | "wordCount"> &
    Partial<ChapterSnapshot>;
};

export type ApplyOpsResult =
  | { ok: true; chapter: ChapterSnapshot; applied: number }
  | {
      ok: false;
      chapter: ChapterSnapshot;
      reason: "stale" | "missing_block" | "gap";
      op: RemoteChapterOp;
    };

function withContent(chapter: ChapterSnapshot, content: string, revision: number): ChapterSnapshot {
  return {
    ...chapter,
    content,
    revision,
    wordCount: countWords(htmlToPlainText(content)),
  };
}

/** Apply server ops that are strictly after the local snapshot revision. */
export function applyRemoteOps(chapter: ChapterSnapshot, ops: RemoteChapterOp[]): ApplyOpsResult {
  const ordered = ops
    .filter((op) => op.chapterId === chapter.id && op.seq > chapter.revision)
    .sort((a, b) => a.seq - b.seq);

  let current = chapter;
  let applied = 0;
  for (const op of ordered) {
    if (op.seq !== current.revision + 1) {
      return { ok: false, chapter: current, reason: "gap", op };
    }
    const { doc } = htmlToDoc(current.content, current.revision);
    const result = applyOp(doc, op);
    if (!result.ok) {
      return { ok: false, chapter: current, reason: result.reason, op };
    }
    current = withContent(current, docToHtml(result.doc), result.doc.revision);
    applied += 1;
  }
  return { ok: true, chapter: current, applied };
}

export function rebaseRejectedOp(rejected: RejectedRemoteOp): {
  chapter: RejectedRemoteOp["chapter"];
  retry: ManuscriptOp | null;
} {
  const chapter = rejected.chapter;
  const retried: ManuscriptOp = {
    ...rejected.op,
    baseRevision: chapter.revision,
  };
  const { doc } = htmlToDoc(chapter.content, chapter.revision);
  const result = applyOp(doc, retried);
  if (!result.ok) {
    return { chapter, retry: null };
  }
  return { chapter, retry: retried };
}

export function applyPendingOps(chapter: ChapterSnapshot, pending: ManuscriptOp[]): ChapterSnapshot {
  let current = chapter;
  for (const op of pending) {
    const { doc } = htmlToDoc(current.content, current.revision);
    const result = applyOp(doc, { ...op, baseRevision: current.revision });
    if (!result.ok) break;
    current = withContent(current, docToHtml(result.doc), result.doc.revision);
  }
  return current;
}
