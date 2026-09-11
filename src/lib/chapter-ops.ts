import type { Chapter, ChapterOp } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedChapter } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import {
  applyOp,
  docToHtml,
  htmlToDoc,
  type ManuscriptActor,
  type ManuscriptOp,
} from "@/lib/manuscript";
import { countWords, htmlToText } from "@/lib/text";

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

const ACTORS = new Set<ManuscriptActor>(["user", "ai", "correction"]);
const TYPES = new Set<ManuscriptOp["type"]>([
  "replace_block",
  "insert_block",
  "delete_block",
]);

export function parseManuscriptOp(value: unknown): ManuscriptOp | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.opId !== "string" || !raw.opId.trim()) return null;
  if (!Number.isInteger(raw.baseRevision) || (raw.baseRevision as number) < 0) return null;
  if (!ACTORS.has(raw.actor as ManuscriptActor)) return null;
  if (!TYPES.has(raw.type as ManuscriptOp["type"])) return null;
  const base = {
    opId: raw.opId.trim(),
    baseRevision: raw.baseRevision as number,
    actor: raw.actor as ManuscriptActor,
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
  return chapter;
}

export async function appendOps(
  chapterId: string,
  user: PublicUser | null,
  ops: ManuscriptOp[],
  opts?: { actor?: ManuscriptActor }
): Promise<AppendOpsResult> {
  const owned = await authorizeOwnedChapter(chapterId, user);
  const accepted: AcceptedOp[] = [];
  const rejected: RejectedOp[] = [];
  const created: ChapterOpRecord[] = [];

  for (const incoming of ops) {
    const op: ManuscriptOp = opts?.actor ? { ...incoming, actor: opts.actor } : incoming;
    const existing = await prisma.chapterOp.findUnique({
      where: { chapterId_opId: { chapterId, opId: op.opId } },
    });
    if (existing) {
      accepted.push({ op: opFromRow(existing), seq: existing.seq });
      continue;
    }

    const chapter = await loadChapter(chapterId);
    const { doc } = htmlToDoc(chapter.content, chapter.revision);
    const applied = applyOp(doc, op);
    if (!applied.ok) {
      rejected.push({ op, reason: applied.reason, chapter });
      continue;
    }

    const content = docToHtml(applied.doc);
    const wordCount = countWords(htmlToText(content));
    const seq = chapter.revision + 1;
    const updated = await prisma.chapter.updateMany({
      where: { id: chapterId, revision: chapter.revision },
      data: { content, wordCount, revision: seq },
    });
    if (updated.count !== 1) {
      const head = await loadChapter(chapterId);
      rejected.push({ op, reason: "stale", chapter: head });
      continue;
    }

    const row = await prisma.chapterOp.create({
      data: {
        chapterId,
        projectId: owned.projectId,
        opId: op.opId,
        seq,
        baseRevision: op.baseRevision,
        actor: op.actor,
        type: op.type,
        payload: payloadOf(op),
      },
    });
    accepted.push({ op, seq });
    created.push(opFromRow(row));
  }

  const chapter = await loadChapter(chapterId);
  return { accepted, rejected, chapter, ops: created };
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
