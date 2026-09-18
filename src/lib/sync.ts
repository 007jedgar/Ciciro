import type { Chapter } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AuthError, authorizeProjectId, type PublicUser } from "@/lib/auth/session";
import { ensureBible, listBibleFiles, writeBibleFile, type BibleFileRecord } from "@/lib/bible";
import {
  appendOps,
  listProjectOps,
  parseManuscriptOp,
  type AcceptedOp,
  type ChapterOpRecord,
  type RejectedOp,
} from "@/lib/chapter-ops";
import { docHash, type ManuscriptOp } from "@/lib/manuscript";
import {
  getReadingPosition,
  putReadingPosition,
  type ReadingPositionRecord,
} from "@/lib/reading-position";

export type SyncAfter = {
  chapters?: Record<string, number>;
  bible?: Record<string, number>;
  /**
   * Fingerprint of the client's *confirmed* document per chapter, at the
   * revision named in `chapters`. Sent only for chapters with nothing pending
   * locally, because a chapter carrying unpushed ops has a locally-advanced
   * revision that names no server seq. See ChapterDivergence.
   */
  hashes?: Record<string, string>;
};

export type SyncOp = ManuscriptOp & { chapterId: string };

export type SyncBibleWrite = {
  path: string;
  revision: number;
  content: string;
};

export type ChapterHead = {
  id: string;
  revision: number;
  wordCount: number;
};

export type BibleHead = {
  path: string;
  revision: number;
};

export type RejectedBible = {
  path: string;
  expectedRevision: number;
  currentRevision: number;
};

/**
 * Two replicas that agree on the revision but not on the bytes. Convergence
 * was being assumed; this is the check that stops assuming it. The whole
 * chapter rides along so the client can heal in the same round trip, and the
 * mismatch is logged rather than swallowed — a divergence is a bug upstream,
 * and it should be visible instead of silently costing the author a paragraph.
 */
export type ChapterDivergence = {
  chapterId: string;
  revision: number;
  clientHash: string;
  serverHash: string;
  chapter: Chapter;
};

export type SyncResult = {
  accepted: AcceptedOp[];
  rejected: RejectedOp[];
  bibleRejected: RejectedBible[];
  chapters: ChapterHead[];
  bible: BibleHead[];
  position: ReadingPositionRecord | null;
  ops: ChapterOpRecord[];
  bibleFiles: BibleFileRecord[];
  diverged: ChapterDivergence[];
};

export function parseSyncAfter(value: unknown): SyncAfter {
  if (value == null || value === "") return {};
  const raw =
    typeof value === "string"
      ? (JSON.parse(value) as unknown)
      : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AuthError("after must be an object", 400);
  }
  const src = raw as { chapters?: unknown; bible?: unknown; hashes?: unknown };
  return {
    chapters: parseRevisionMap(src.chapters),
    bible: parseRevisionMap(src.bible),
    hashes: parseHashMap(src.hashes),
  };
}

function parseHashMap(value: unknown): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError("after maps must be objects", 400);
  }
  const out: Record<string, string> = {};
  for (const [key, hash] of Object.entries(value as Record<string, unknown>)) {
    if (typeof hash !== "string" || !hash) {
      throw new AuthError("after hashes must be non-empty strings", 400);
    }
    out[key] = hash;
  }
  return out;
}

function parseRevisionMap(value: unknown): Record<string, number> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError("after maps must be objects", 400);
  }
  const out: Record<string, number> = {};
  for (const [key, rev] of Object.entries(value as Record<string, unknown>)) {
    if (!Number.isInteger(rev) || (rev as number) < 0) {
      throw new AuthError("after revisions must be non-negative integers", 400);
    }
    out[key] = rev as number;
  }
  return out;
}

export function parseSyncOp(value: unknown): SyncOp | null {
  if (!value || typeof value !== "object") return null;
  const chapterId =
    typeof (value as { chapterId?: unknown }).chapterId === "string"
      ? (value as { chapterId: string }).chapterId.trim()
      : "";
  const op = parseManuscriptOp(value);
  if (!op || !chapterId) return null;
  return { ...op, chapterId };
}

/** Keep each chapter's ops together and in the order the client sent them. */
function opsByChapter(ops: SyncOp[]): Map<string, ManuscriptOp[]> {
  const byChapter = new Map<string, ManuscriptOp[]>();
  for (const { chapterId, ...op } of ops) {
    const list = byChapter.get(chapterId);
    if (list) list.push(op as ManuscriptOp);
    else byChapter.set(chapterId, [op as ManuscriptOp]);
  }
  return byChapter;
}

async function requireProject(projectId: string, user: PublicUser | null) {
  if (!projectId) throw new AuthError("projectId required", 400);
  await authorizeProjectId(projectId, user);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new AuthError("Not found.", 404);
}

async function chapterHeads(projectId: string): Promise<ChapterHead[]> {
  return prisma.chapter.findMany({
    where: { projectId },
    select: { id: true, revision: true, wordCount: true },
    orderBy: { order: "asc" },
  });
}

/**
 * Compare the client's fingerprints against ours at the same revision. A
 * chapter the client is merely behind on is not diverged — the ops in this
 * same response will carry it forward. Only equal revisions with unequal bytes
 * are a real split, and those come back with the whole chapter so the caller
 * can overwrite and move on.
 */
async function divergedChapters(
  projectId: string,
  after: SyncAfter
): Promise<ChapterDivergence[]> {
  const hashes = after.hashes;
  if (!hashes) return [];
  const ids = Object.keys(hashes);
  if (ids.length === 0) return [];

  // Narrow on revision before reading any prose. A client that is behind is
  // not diverged, and hashing a chapter needs its whole content — so checking
  // every chapter every time would drag the entire manuscript across the wire
  // and through the hash on each pull.
  const heads = await prisma.chapter.findMany({
    where: { projectId, id: { in: ids } },
    select: { id: true, revision: true },
  });
  const suspect = heads
    .filter((head) => after.chapters?.[head.id] === head.revision)
    .map((head) => head.id);
  if (suspect.length === 0) return [];

  const rows = await prisma.chapter.findMany({ where: { id: { in: suspect } } });
  const diverged: ChapterDivergence[] = [];
  for (const chapter of rows) {
    const clientHash = hashes[chapter.id];
    if (!clientHash) continue;
    const serverHash = docHash(chapter.content);
    if (serverHash === clientHash) continue;
    console.warn(
      `[sync] chapter ${chapter.id} diverged at revision ${chapter.revision}: ` +
        `client ${clientHash}, server ${serverHash}`
    );
    diverged.push({
      chapterId: chapter.id,
      revision: chapter.revision,
      clientHash,
      serverHash,
      chapter,
    });
  }
  return diverged;
}

async function bibleHeads(projectId: string): Promise<BibleHead[]> {
  return prisma.bibleFile.findMany({
    where: { projectId },
    select: { path: true, revision: true },
    orderBy: { path: "asc" },
  });
}

export async function pullSync(
  projectId: string,
  user: PublicUser | null,
  after: SyncAfter = {}
): Promise<SyncResult> {
  await requireProject(projectId, user);
  await ensureBible(projectId);
  const [ops, bibleFiles, position, chapters, bible, diverged] = await Promise.all([
    listProjectOps(projectId, after.chapters),
    listBibleFiles(projectId, after.bible),
    getReadingPosition(projectId, user),
    chapterHeads(projectId),
    bibleHeads(projectId),
    divergedChapters(projectId, after),
  ]);
  return {
    accepted: [],
    rejected: [],
    bibleRejected: [],
    chapters,
    bible,
    position,
    ops,
    bibleFiles,
    diverged,
  };
}

export async function pushSync(
  projectId: string,
  user: PublicUser | null,
  input: {
    after?: SyncAfter;
    ops?: SyncOp[];
    bible?: SyncBibleWrite[];
    position?: { chapterId: string; blockId: string; offset: number };
  }
): Promise<SyncResult> {
  await requireProject(projectId, user);

  const accepted: AcceptedOp[] = [];
  const rejected: RejectedOp[] = [];
  const bibleRejected: RejectedBible[] = [];

  // One call per chapter, not per op: a group only stays atomic if the whole
  // group reaches appendOps together. Ownership is still verified for every
  // chapter named in the body, and appendOps re-checks it.
  for (const [chapterId, chapterOps] of opsByChapter(input.ops ?? [])) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true, projectId: true },
    });
    if (!chapter || chapter.projectId !== projectId) {
      throw new AuthError("Not found.", 404);
    }
    const result = await appendOps(chapter.id, user, chapterOps, { actor: "user" });
    accepted.push(...result.accepted);
    rejected.push(...result.rejected);
  }

  for (const file of input.bible ?? []) {
    try {
      await writeBibleFile(projectId, file.path, file.content, file.revision);
    } catch (error) {
      if (error instanceof AuthError && error.status === 409) {
        const body = (error.body ?? {}) as {
          path?: string;
          expectedRevision?: number;
          currentRevision?: number;
        };
        bibleRejected.push({
          path: body.path ?? file.path,
          expectedRevision: body.expectedRevision ?? file.revision,
          currentRevision: body.currentRevision ?? file.revision,
        });
        continue;
      }
      throw error;
    }
  }

  if (input.position) {
    await putReadingPosition(projectId, user, input.position);
  }

  const pulled = await pullSync(projectId, user, input.after ?? {});
  return {
    ...pulled,
    accepted,
    rejected,
    bibleRejected,
  };
}
