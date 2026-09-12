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
import { scheduleChapterSummary } from "@/lib/summarize";
import type { ManuscriptOp } from "@/lib/manuscript";
import {
  getReadingPosition,
  putReadingPosition,
  type ReadingPositionRecord,
} from "@/lib/reading-position";

export type SyncAfter = {
  chapters?: Record<string, number>;
  bible?: Record<string, number>;
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

export type SyncResult = {
  accepted: AcceptedOp[];
  rejected: RejectedOp[];
  bibleRejected: RejectedBible[];
  chapters: ChapterHead[];
  bible: BibleHead[];
  position: ReadingPositionRecord | null;
  ops: ChapterOpRecord[];
  bibleFiles: BibleFileRecord[];
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
  const src = raw as { chapters?: unknown; bible?: unknown };
  return {
    chapters: parseRevisionMap(src.chapters),
    bible: parseRevisionMap(src.bible),
  };
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
  const [ops, bibleFiles, position, chapters, bible] = await Promise.all([
    listProjectOps(projectId, after.chapters),
    listBibleFiles(projectId, after.bible),
    getReadingPosition(projectId, user),
    chapterHeads(projectId),
    bibleHeads(projectId),
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
  const dirtyChapters = new Set<string>();

  for (const op of input.ops ?? []) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: op.chapterId },
      select: { id: true, projectId: true },
    });
    if (!chapter || chapter.projectId !== projectId) {
      throw new AuthError("Not found.", 404);
    }
    const result = await appendOps(chapter.id, user, [op]);
    accepted.push(...result.accepted);
    rejected.push(...result.rejected);
    if (result.ops.length > 0) dirtyChapters.add(chapter.id);
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

  for (const chapterId of dirtyChapters) {
    void scheduleChapterSummary(chapterId);
  }

  const pulled = await pullSync(projectId, user, input.after ?? {});
  return {
    ...pulled,
    accepted,
    rejected,
    bibleRejected,
  };
}
