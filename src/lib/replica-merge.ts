import {
  applyOp,
  docToHtml,
  htmlToDoc,
  mergeReplaceHtml,
  type ManuscriptOp,
} from "@/lib/manuscript";
import { chapterWordCount } from "@/lib/text";

export type ReplicaChapterHead = {
  id: string;
  projectId: string;
  content: string;
  revision: number;
  wordCount: number;
  title?: string;
  status?: string;
  summary?: string;
};

export type RemoteChapterOp = ManuscriptOp & {
  chapterId: string;
  seq: number;
};

export type RejectedRemoteOp = {
  op: ManuscriptOp;
  reason: "stale" | "missing_block";
  chapter: ReplicaChapterHead;
};

export type ApplyOpsResult =
  | { ok: true; chapter: ReplicaChapterHead; applied: number }
  | {
      ok: false;
      chapter: ReplicaChapterHead;
      reason: "stale" | "missing_block" | "gap";
      op: RemoteChapterOp;
    };

function withContent(chapter: ReplicaChapterHead, content: string, revision: number): ReplicaChapterHead {
  return {
    ...chapter,
    content,
    revision,
    wordCount: chapterWordCount(content),
  };
}

/** Apply server ops that are strictly after the local snapshot revision. */
export function applyRemoteOps(
  chapter: ReplicaChapterHead,
  ops: RemoteChapterOp[]
): ApplyOpsResult {
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

/**
 * After a CAS reject, take the server snapshot and retry the local op on top.
 * Returns null when the op cannot be rebased (missing block / unapplicable).
 */
export function rebaseRejectedOp(rejected: RejectedRemoteOp): {
  chapter: ReplicaChapterHead;
  retry: ManuscriptOp | null;
} {
  const chapter = rejected.chapter;
  const { doc } = htmlToDoc(chapter.content, chapter.revision);
  const retried: ManuscriptOp =
    rejected.op.type === "replace_block"
      ? {
          ...rejected.op,
          baseRevision: chapter.revision,
          html: mergeReplaceHtml(
            doc.blocks.find((block) => block.id === rejected.op.blockId)?.html ?? rejected.op.html,
            rejected.op.html
          ),
        }
      : { ...rejected.op, baseRevision: chapter.revision };
  const result = applyOp(doc, retried);
  if (!result.ok) {
    return { chapter, retry: null };
  }
  return { chapter, retry: retried };
}

/** Overlay un-acked local ops onto the last server snapshot for display. */
export function applyPendingOps(
  chapter: ReplicaChapterHead,
  pending: ManuscriptOp[]
): ReplicaChapterHead {
  let current = chapter;
  for (const op of pending) {
    const { doc } = htmlToDoc(current.content, current.revision);
    const result = applyOp(doc, { ...op, baseRevision: current.revision });
    if (!result.ok) break;
    current = withContent(current, docToHtml(result.doc), result.doc.revision);
  }
  return current;
}
