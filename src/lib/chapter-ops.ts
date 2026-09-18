import type { Chapter, ChapterOp } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedChapter } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { publishChapterHeads } from "@/lib/chapter-poke";
import {
  applyOp,
  docToHtml,
  htmlToDoc,
  OP_VERSION,
  type ManuscriptActor,
  type ManuscriptOp,
} from "@/lib/manuscript";
import { countWords, htmlToText } from "@/lib/text";
import { ensureBlockIds } from "@/lib/block-ids";

export type ChapterOpRecord = ManuscriptOp & {
  chapterId: string;
  projectId: string;
  seq: number;
  createdAt: Date;
};

export type AcceptedOp = {
  op: ManuscriptOp;
  seq: number;
};

export type RejectedOp = {
  op: ManuscriptOp;
  reason: "stale" | "missing_block";
  chapter: Chapter;
};

export type AppendOpsResult = {
  accepted: AcceptedOp[];
  rejected: RejectedOp[];
  chapter: Chapter;
  ops: ChapterOpRecord[];
};

export type AppendOpsOptions = {
  /**
   * Provenance for every op in this call, derived from the calling route. An
   * `actor` sent by a client is parsed and then discarded: nothing reaching the
   * server over an author route gets to claim it was the assistant.
   */
  actor: ManuscriptActor;
};

const ACTORS = new Set<ManuscriptActor>(["user", "ai", "correction"]);
const TYPES = new Set<ManuscriptOp["type"]>([
  "replace_block",
  "insert_block",
  "delete_block",
]);

/**
 * The op format version in a request body, or null when every op speaks a
 * version this server understands. An old build keeps POSTing the shape it
 * knows; when we change that shape it has to be told to upgrade, not have its
 * unknown fields quietly dropped and its prose land malformed.
 */
export function unsupportedOpVersion(values: unknown[]): number | null {
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const v = (value as { v?: unknown }).v;
    if (v === undefined || v === null) continue;
    // A `v` that is not a version at all is malformed input, not an old build;
    // parseManuscriptOp turns that into a 400 rather than "please upgrade".
    if (!Number.isInteger(v) || (v as number) < 1) continue;
    if ((v as number) > OP_VERSION) return v as number;
  }
  return null;
}

export function parseManuscriptOp(value: unknown): ManuscriptOp | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.opId !== "string" || !raw.opId.trim()) return null;
  if (!Number.isInteger(raw.baseRevision) || (raw.baseRevision as number) < 0) return null;
  if (!TYPES.has(raw.type as ManuscriptOp["type"])) return null;
  if (raw.groupId !== undefined && raw.groupId !== null && typeof raw.groupId !== "string") {
    return null;
  }
  if (raw.v !== undefined && raw.v !== null && (!Number.isInteger(raw.v) || (raw.v as number) < 1)) {
    return null;
  }
  const base = {
    opId: raw.opId.trim(),
    baseRevision: raw.baseRevision as number,
    // Kept so a row read back out of the log round-trips. On the write path the
    // caller overwrites it; see AppendOpsOptions.
    actor: ACTORS.has(raw.actor as ManuscriptActor) ? (raw.actor as ManuscriptActor) : "user",
    groupId: typeof raw.groupId === "string" && raw.groupId ? raw.groupId : null,
    v: Number.isInteger(raw.v) ? (raw.v as number) : OP_VERSION,
  };
  if (raw.type === "replace_block") {
    if (typeof raw.blockId !== "string" || !raw.blockId) return null;
    if (typeof raw.html !== "string") return null;
    return { ...base, type: "replace_block", blockId: raw.blockId, html: raw.html };
  }
  if (raw.type === "delete_block") {
    if (typeof raw.blockId !== "string" || !raw.blockId) return null;
    return { ...base, type: "delete_block", blockId: raw.blockId };
  }
  if (typeof raw.blockId !== "string" || !raw.blockId) return null;
  if (typeof raw.html !== "string") return null;
  if (raw.afterBlockId !== null && typeof raw.afterBlockId !== "string") return null;
  return {
    ...base,
    type: "insert_block",
    blockId: raw.blockId,
    html: raw.html,
    afterBlockId: raw.afterBlockId as string | null,
  };
}

export function payloadOf(op: ManuscriptOp): string {
  if (op.type === "replace_block") {
    return JSON.stringify({ blockId: op.blockId, html: op.html });
  }
  if (op.type === "insert_block") {
    return JSON.stringify({
      blockId: op.blockId,
      html: op.html,
      afterBlockId: op.afterBlockId,
    });
  }
  return JSON.stringify({ blockId: op.blockId });
}

export function opFromRow(row: ChapterOp): ChapterOpRecord {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const parsed = parseManuscriptOp({
    opId: row.opId,
    baseRevision: row.baseRevision,
    actor: row.actor,
    type: row.type,
    groupId: row.groupId,
    v: row.v,
    ...payload,
  });
  if (!parsed) {
    throw new Error(`Corrupt chapter op ${row.id}`);
  }
  return {
    ...parsed,
    chapterId: row.chapterId,
    projectId: row.projectId,
    seq: row.seq,
    createdAt: row.createdAt,
  };
}

async function loadChapter(chapterId: string): Promise<Chapter> {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) throw new AuthError("Not found.", 404);
  // Legacy rows are stamped here so an op aimed at a stable id can land.
  return ensureBlockIds(chapter);
}

/** A unique-constraint failure, however the adapter chose to surface it. */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { code?: unknown }).code === "P2002") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /unique constraint failed/i.test(message);
}

type OpGroup = { groupId: string | null; ops: ManuscriptOp[] };

/**
 * Split a push into units of atomicity. Ops sharing a groupId are one
 * authoring action and travel together even if the client interleaved them;
 * an ungrouped op is its own unit, which is what a single keystroke flush is.
 */
function groupOps(ops: ManuscriptOp[]): OpGroup[] {
  const groups: OpGroup[] = [];
  const byId = new Map<string, OpGroup>();
  for (const op of ops) {
    const groupId = op.groupId ?? null;
    if (!groupId) {
      groups.push({ groupId: null, ops: [op] });
      continue;
    }
    const open = byId.get(groupId);
    if (open) {
      open.ops.push(op);
      continue;
    }
    const group: OpGroup = { groupId, ops: [op] };
    byId.set(groupId, group);
    groups.push(group);
  }
  return groups;
}

type GroupOutcome = {
  accepted: AcceptedOp[];
  rejected: RejectedOp[];
  created: ChapterOpRecord[];
};

/**
 * Apply one group against the chapter head and commit it as a single write.
 *
 * The log is the source of truth and `Chapter.content` is the cache it
 * projects onto, so both move in one `$transaction([...])` — a `D1.batch()` on
 * Cloudflare, a real transaction on local sqlite. Claiming `seq` is what makes
 * the write safe: `@@unique([chapterId, seq])` means a concurrent writer aiming
 * at the same revision loses the whole batch instead of bumping `revision` with
 * no op behind it.
 */
async function applyGroup(
  chapterId: string,
  projectId: string,
  group: OpGroup,
  actor: ManuscriptActor
): Promise<GroupOutcome> {
  const stamped: ManuscriptOp[] = group.ops.map((op) => ({
    ...op,
    actor,
    groupId: group.groupId,
    v: op.v ?? OP_VERSION,
  }));

  // A push whose response was lost still committed. Replaying it must be a
  // no-op, not a second copy of the paragraph.
  const existing = await prisma.chapterOp.findMany({
    where: { chapterId, opId: { in: stamped.map((op) => op.opId) } },
  });
  const committed = new Map(existing.map((row) => [row.opId, row]));
  const accepted: AcceptedOp[] = [];
  const pending: ManuscriptOp[] = [];
  for (const op of stamped) {
    const row = committed.get(op.opId);
    if (row) accepted.push({ op: opFromRow(row), seq: row.seq });
    else pending.push(op);
  }
  if (pending.length === 0) return { accepted, rejected: [], created: [] };

  const chapter = await loadChapter(chapterId);
  const base = chapter.revision;
  let doc = htmlToDoc(chapter.content, base).doc;
  for (const op of pending) {
    const result = applyOp(doc, op);
    if (!result.ok) {
      // One authoring action, one verdict. Rejecting only the op that failed is
      // how a split lands its first half and drops its second.
      return {
        accepted,
        rejected: pending.map((item) => ({ op: item, reason: result.reason, chapter })),
        created: [],
      };
    }
    doc = result.doc;
  }

  const content = docToHtml(doc);
  const wordCount = countWords(htmlToText(content));
  const head = base + pending.length;
  const rows = pending.map((op, index) =>
    prisma.chapterOp.create({
      data: {
        chapterId,
        projectId,
        opId: op.opId,
        seq: base + index + 1,
        baseRevision: op.baseRevision,
        actor: op.actor,
        type: op.type,
        payload: payloadOf(op),
        groupId: group.groupId,
        v: op.v ?? OP_VERSION,
      },
    })
  );

  let snapshotWrites = 0;
  try {
    const results = await prisma.$transaction([
      ...rows,
      prisma.chapter.updateMany({
        where: { id: chapterId, revision: base },
        data: { content, wordCount, revision: head },
      }),
    ]);
    snapshotWrites = (results[results.length - 1] as { count: number }).count;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return lostTheRace(chapterId, accepted, pending);
  }

  if (snapshotWrites !== 1) {
    // We hold seqs base+1..head, which is the right to write those revisions.
    // The guarded update matching nothing means something moved `revision`
    // without claiming a seq. Project the log's result onto the cache — never
    // backwards over a revision newer than the one we own.
    await prisma.chapter.updateMany({
      where: { id: chapterId, revision: { lt: head } },
      data: { content, wordCount, revision: head },
    });
  }

  // Built here rather than read back out of the batch: what the log now holds
  // is fully determined by what we just claimed, and the adapter's shape for
  // batched `create` returns is not worth depending on. `createdAt` is the
  // write moment; consumers order by `seq`.
  const createdAt = new Date();
  const created: ChapterOpRecord[] = [];
  pending.forEach((op, index) => {
    const seq = base + index + 1;
    created.push({ ...op, chapterId, projectId, seq, createdAt });
    accepted.push({ op, seq });
  });
  return { accepted, rejected: [], created };
}

/**
 * The batch was rolled back by a unique violation. Either another writer took
 * the seqs we wanted, or the very same ops arrived twice at once. Re-read the
 * log to tell those apart, so a duplicate is accepted and a genuine race is
 * sent back for the client to rebase.
 */
async function lostTheRace(
  chapterId: string,
  accepted: AcceptedOp[],
  pending: ManuscriptOp[]
): Promise<GroupOutcome> {
  const rows = await prisma.chapterOp.findMany({
    where: { chapterId, opId: { in: pending.map((op) => op.opId) } },
  });
  const committed = new Map(rows.map((row) => [row.opId, row]));
  const chapter = await loadChapter(chapterId);
  const rejected: RejectedOp[] = [];
  for (const op of pending) {
    const row = committed.get(op.opId);
    if (row) accepted.push({ op: opFromRow(row), seq: row.seq });
    else rejected.push({ op, reason: "stale", chapter });
  }
  return { accepted, rejected, created: [] };
}

async function appendGroups(
  chapterId: string,
  projectId: string,
  ops: ManuscriptOp[],
  actor: ManuscriptActor
): Promise<AppendOpsResult> {
  const accepted: AcceptedOp[] = [];
  const rejected: RejectedOp[] = [];
  const created: ChapterOpRecord[] = [];

  for (const group of groupOps(ops)) {
    if (rejected.length > 0) {
      // Everything after a rejection goes back with it. One client's queue is a
      // causal run: a `replace_block` carries the whole block, built on top of
      // what the op before it wrote. Accepting a later op whose base happens to
      // name the head — while the op it was written on top of was refused —
      // means the client rebases the refused one and replays it over the newer
      // text. Both were acknowledged; the author still loses the sentence.
      const head = await loadChapter(chapterId);
      for (const op of group.ops) {
        rejected.push({ op, reason: "stale", chapter: head });
      }
      continue;
    }
    const outcome = await applyGroup(chapterId, projectId, group, actor);
    accepted.push(...outcome.accepted);
    rejected.push(...outcome.rejected);
    created.push(...outcome.created);
  }

  const chapter = await loadChapter(chapterId);
  if (created.length > 0) {
    await publishChapterHeads(projectId, [{ chapterId, revision: chapter.revision }]);
  }
  return { accepted, rejected, chapter, ops: created };
}

/** Append author ops to a chapter the caller's session owns. */
export async function appendOps(
  chapterId: string,
  user: PublicUser | null,
  ops: ManuscriptOp[],
  opts: AppendOpsOptions
): Promise<AppendOpsResult> {
  const owned = await authorizeOwnedChapter(chapterId, user);
  return appendGroups(chapterId, owned.projectId, ops, opts.actor);
}

/**
 * Append ops from a server-side writer — autowrite, the passage tools — that
 * already authorized the project and may be running on a durable slice with no
 * session to read. The chapter is still checked against the project the caller
 * authorized, so a stale chapterId cannot write into someone else's book.
 */
export async function appendSystemOps(
  chapterId: string,
  projectId: string,
  ops: ManuscriptOp[],
  opts: AppendOpsOptions = { actor: "ai" }
): Promise<AppendOpsResult> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, projectId: true },
  });
  if (!chapter) throw new AuthError("Not found.", 404);
  if (chapter.projectId !== projectId) throw new AuthError("Not found.", 404);
  return appendGroups(chapterId, projectId, ops, opts.actor);
}

export async function listChapterOps(
  chapterId: string,
  user: PublicUser | null,
  afterSeq = 0
): Promise<{ chapter: Chapter; ops: ChapterOpRecord[] }> {
  await authorizeOwnedChapter(chapterId, user);
  const chapter = await loadChapter(chapterId);
  const rows = await prisma.chapterOp.findMany({
    where: { chapterId, seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
  });
  return { chapter, ops: rows.map(opFromRow) };
}

export async function listProjectOps(
  projectId: string,
  afterByChapter?: Record<string, number>
): Promise<ChapterOpRecord[]> {
  const chapters = await prisma.chapter.findMany({
    where: { projectId },
    select: { id: true },
  });
  const rows: ChapterOp[] = [];
  for (const chapter of chapters) {
    const after = afterByChapter?.[chapter.id] ?? 0;
    const found = await prisma.chapterOp.findMany({
      where: { chapterId: chapter.id, seq: { gt: after } },
      orderBy: { seq: "asc" },
    });
    rows.push(...found);
  }
  return rows.map(opFromRow);
}
