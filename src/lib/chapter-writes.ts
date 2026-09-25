import { appendSystemOps } from "@/lib/chapter-ops";
import { snapshotBeforeAiWrite } from "@/lib/snapshots";
import {
  diffHtmlToOps,
  htmlToDoc,
  stampBlockIds,
  type ManuscriptActor,
  type ManuscriptOp,
} from "@/lib/manuscript";

// The one way a server-side writer — autowrite, the passage tools — changes a
// chapter's prose.
//
// Writing `Chapter.content` and incrementing `Chapter.revision` directly is the
// "the log is optional" hole: the phone replays ops, finds the head moved with
// no ops to explain it, and has to smash-refetch the whole chapter. That
// refetch is what eats a keystroke buffer mid-sentence. Everything here turns
// an HTML edit into ops first and lets `appendSystemOps` move the head, so the
// snapshot only ever moves as the log's projection.

/**
 * What a caller wants the chapter to say. `wordCount` is whatever the caller
 * already computed for its own report; the committed count is derived from the
 * committed HTML, so this one is advisory.
 */
export type ChapterHtmlWrite = { content: string; wordCount?: number };

export type ChapterWriteResult = {
  /** False only when the write lost the revision race and nothing was applied. */
  ok: boolean;
  revision: number;
  content: string;
};

type ChapterHead = {
  id: string;
  projectId: string;
  content: string;
  revision: number;
};

const newId = (): string => crypto.randomUUID();

/**
 * Whole-document replacement, expressed as ops: every existing block deleted,
 * every new block inserted, all under one group id.
 *
 * `diffHtmlToOps` throws when it emits an op it cannot apply to its own
 * document — HTML the passage helpers cut in a way the block diff cannot
 * address. The tempting fallback is a raw snapshot write, which is the exact
 * hole this module closes, so the fallback stays in the log instead. It costs
 * the reader a wide repaint of the chapter; it cannot cost anyone their text.
 */
function wholeDocumentOps(
  oldHtml: string,
  nextHtml: string,
  baseRevision: number,
  actor: ManuscriptActor,
  groupId: string
): ManuscriptOp[] {
  const before = htmlToDoc(oldHtml, baseRevision).doc;
  const after = htmlToDoc(nextHtml, baseRevision).doc;
  const ops: ManuscriptOp[] = [];
  // Each op is applied against the document the one before it produced, so the
  // baseRevisions climb even though they all land in a single commit.
  let revision = baseRevision;
  for (const block of before.blocks) {
    ops.push({
      opId: newId(),
      baseRevision: revision++,
      actor,
      groupId,
      type: "delete_block",
      blockId: block.id,
    });
  }
  let afterBlockId: string | null = null;
  for (const block of after.blocks) {
    ops.push({
      opId: newId(),
      baseRevision: revision++,
      actor,
      groupId,
      type: "insert_block",
      blockId: block.id,
      html: block.html,
      afterBlockId,
    });
    afterBlockId = block.id;
  }
  return ops;
}

/**
 * Commit `nextHtml` as the chapter's prose, as ops, in one group.
 *
 * The compare-and-swap lives in the ops' `baseRevision`: if anything moved the
 * head between the caller reading `chapter` and this commit, the whole group is
 * rejected and `ok` is false — nothing half-applies, and the caller reports its
 * own conflict to whoever asked for the write.
 */
export async function writeChapterHtml(
  chapter: ChapterHead,
  nextHtml: string,
  opts?: { actor?: ManuscriptActor; groupId?: string }
): Promise<ChapterWriteResult> {
  const actor = opts?.actor ?? "ai";
  const groupId = opts?.groupId ?? newId();

  let ops: ManuscriptOp[];
  try {
    ops = diffHtmlToOps(chapter.content, nextHtml, chapter.revision, { actor, groupId });
  } catch {
    ops = wholeDocumentOps(chapter.content, nextHtml, chapter.revision, actor, groupId);
  }

  // Nothing changed. Bumping the revision anyway would tell every replica to
  // come and fetch a document it already has.
  if (ops.length === 0) {
    return { ok: true, revision: chapter.revision, content: stampBlockIds(nextHtml) };
  }

  // The editor is about to change prose the author may want back.
  if (actor === "ai") await snapshotBeforeAiWrite(chapter);

  const result = await appendSystemOps(chapter.id, chapter.projectId, ops, { actor });
  return {
    ok: result.rejected.length === 0,
    revision: result.chapter.revision,
    content: result.chapter.content,
  };
}
