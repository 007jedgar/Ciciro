import { htmlToPlainText } from "./html";
import { applyOp, countWords, docToHtml, htmlToDoc, mergeReplaceHtml } from "./manuscript";
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
  /** Leave these blocks' HTML alone so a focused editor is not clobbered. */
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

function lastBlockId(doc: { blocks: { id: string }[] }): string | null {
  return doc.blocks.length === 0 ? null : doc.blocks[doc.blocks.length - 1].id;
}

function restampOp(doc: { revision: number; blocks: { id: string; html: string }[] }, op: ManuscriptOp): ManuscriptOp {
  const restamped: ManuscriptOp = { ...op, baseRevision: doc.revision };
  if (restamped.type !== "replace_block") return restamped;
  const live = doc.blocks.find((block) => block.id === restamped.blockId);
  if (!live) return restamped;
  return { ...restamped, html: mergeReplaceHtml(live.html, restamped.html) };
}

/**
 * Re-aim a rejected op at the server's current head. A `stale` op only needs
 * its base revision restamped. A `missing_block` op is prose the author typed
 * into a paragraph the server no longer has; rather than drop it, the text is
 * appended as a fresh paragraph. Only a delete of a vanished block is dropped,
 * since there is nothing left to delete.
 */
export function rebaseRejectedOp(rejected: RejectedRemoteOp): {
  chapter: RejectedRemoteOp["chapter"];
  retry: ManuscriptOp | null;
} {
  const chapter = rejected.chapter;
  const { doc } = htmlToDoc(chapter.content, chapter.revision);
  const restamped = restampOp(doc, rejected.op);
  if (applyOp(doc, restamped).ok) {
    return { chapter, retry: restamped };
  }
  const op = rejected.op;
  if (op.type === "delete_block") {
    return { chapter, retry: null };
  }
  const text = htmlToDoc(op.html, 0).doc.blocks[0]?.text ?? "";
  if (!text.trim()) {
    return { chapter, retry: null };
  }
  const appended: ManuscriptOp = {
    opId: op.opId,
    baseRevision: chapter.revision,
    actor: op.actor,
    type: "insert_block",
    afterBlockId: lastBlockId(doc),
    blockId: op.blockId,
    html: op.html,
  };
  if (doc.blocks.some((block) => block.id === op.blockId)) {
    // The id exists but the op could not apply (unknown anchor); the
    // paragraph is already on the server, so there is nothing to add.
    return { chapter, retry: null };
  }
  return { chapter, retry: applyOp(doc, appended).ok ? appended : null };
}

export type RejectedRemoteGroup = {
  ops: ManuscriptOp[];
  reason: "stale" | "missing_block";
  chapter: RejectedRemoteOp["chapter"];
};

/**
 * Re-aim a whole rejected group at the server's head. A group is one authoring
 * action, so it has to move as a unit: rebasing its ops one at a time is how
 * the replace half of a split lands and the insert half is left behind.
 *
 * The common case is a group the server merely had not seen yet — restamp the
 * base revisions in sequence and the whole thing replays. When it genuinely
 * cannot replay (the server no longer has the paragraph it was aimed at) each
 * op falls back to the single-op rebase against a running document, which
 * keeps the author's prose by appending it rather than dropping it. Those
 * salvaged ops travel ungrouped: insisting on atomicity there would throw away
 * the parts that could still land.
 */
export function rebaseRejectedGroup(rejected: RejectedRemoteGroup): {
  chapter: RejectedRemoteOp["chapter"];
  retry: ManuscriptOp[];
} {
  const chapter = rejected.chapter;
  const { doc } = htmlToDoc(chapter.content, chapter.revision);

  let current = doc;
  const replayed: ManuscriptOp[] = [];
  for (const op of rejected.ops) {
    const restamped = restampOp(current, op);
    const result = applyOp(current, restamped);
    if (!result.ok) break;
    current = result.doc;
    replayed.push(restamped);
  }
  if (replayed.length === rejected.ops.length) return { chapter, retry: replayed };

  let running = doc;
  const salvaged: ManuscriptOp[] = [];
  for (const op of rejected.ops) {
    const one = rebaseRejectedOp({
      op,
      reason: rejected.reason,
      chapter: { ...chapter, content: docToHtml(running), revision: running.revision },
    });
    if (!one.retry) continue;
    const applied = applyOp(running, one.retry);
    if (!applied.ok) continue;
    running = applied.doc;
    salvaged.push({ ...one.retry, groupId: null });
  }
  return { chapter, retry: salvaged };
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
