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
  | { ok: true; chapter: ChapterSnapshot; applied: number; skipped: number }
  | {
      ok: false;
      chapter: ChapterSnapshot;
      reason: "stale" | "missing_block" | "gap";
      op: RemoteChapterOp;
    };

export type ApplyRemoteOpsOptions = {
  /** Leave these blocks' HTML alone so a focused TextInput is not clobbered. */
  skipBlockIds?: Iterable<string>;
};

/** True when applying the op would rewrite or remove the given block. */
export function opTouchesBlock(op: ManuscriptOp, blockId: string): boolean {
  if (op.type === "insert_block") return op.blockId === blockId;
  return op.blockId === blockId;
}

function withContent(chapter: ChapterSnapshot, content: string, revision: number): ChapterSnapshot {
  return {
    ...chapter,
    content,
    revision,
    wordCount: countWords(htmlToPlainText(content)),
  };
}

/** Re-stamp focused block HTML from `local` onto a newer snapshot so a pull cannot clobber typing. */
export function preserveFocusedBlocks(
  local: ChapterSnapshot,
  remote: ChapterSnapshot,
  skipBlockIds?: Iterable<string>
): ChapterSnapshot {
  const skip = new Set(skipBlockIds ?? []);
  if (skip.size === 0) return remote;
  const localDoc = htmlToDoc(local.content, local.revision).doc;
  const remoteDoc = htmlToDoc(remote.content, remote.revision).doc;
  const localById = new Map(localDoc.blocks.map((block) => [block.id, block]));
  let changed = false;
  const blocks = remoteDoc.blocks.map((block) => {
    const keep = skip.has(block.id) ? localById.get(block.id) : undefined;
    if (!keep || keep.html === block.html) return block;
    changed = true;
    return keep;
  });
  if (!changed) return remote;
  return withContent(remote, docToHtml({ ...remoteDoc, blocks }), remote.revision);
}

/** Apply server ops that are strictly after the local snapshot revision. */
export function applyRemoteOps(
  chapter: ChapterSnapshot,
  ops: RemoteChapterOp[],
  opts?: ApplyRemoteOpsOptions
): ApplyOpsResult {
  const skip = new Set(opts?.skipBlockIds ?? []);
  const ordered = ops
    .filter((op) => op.chapterId === chapter.id && op.seq > chapter.revision)
    .sort((a, b) => a.seq - b.seq);

  let current = chapter;
  let applied = 0;
  let skipped = 0;
  for (const op of ordered) {
    if (op.seq !== current.revision + 1) {
      return { ok: false, chapter: current, reason: "gap", op };
    }
    const skipThis = skip.has(op.blockId);
    if (skipThis) {
      current = { ...current, revision: current.revision + 1 };
      skipped += 1;
      continue;
    }
    const { doc } = htmlToDoc(current.content, current.revision);
    const result = applyOp(doc, op);
    if (!result.ok) {
      return { ok: false, chapter: current, reason: result.reason, op };
    }
    current = withContent(current, docToHtml(result.doc), result.doc.revision);
    applied += 1;
  }
  return { ok: true, chapter: current, applied, skipped };
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
