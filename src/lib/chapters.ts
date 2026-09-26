import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedChapter } from "@/lib/auth/access";
import { AuthError, authorizeProjectId, type PublicUser } from "@/lib/auth/session";
import { appendOps } from "@/lib/chapter-ops";
import { ensureChaptersBlockIds } from "@/lib/block-ids";
import { diffHtmlToOps, stampBlockIds } from "@/lib/manuscript";
import { countWords, htmlToText, isChapterEmpty } from "@/lib/text";

/** Live chapters the author still sees. Archived rows are hidden, not deleted. */
export const visibleChapterWhere = { archivedAt: null } as const;

export const visibleChaptersInclude = {
  where: visibleChapterWhere,
  orderBy: { order: "asc" as const },
};

/** Ids only — D1 cannot run Prisma `_count` with a relation `where`. */
export const visibleChapterIdInclude = {
  where: visibleChapterWhere,
  select: { id: true },
} as const;

export function withVisibleChapterCount<T extends { chapters: { id: string }[] }>(
  row: T
): Omit<T, "chapters"> & { _count: { chapters: number } } {
  const { chapters, ...rest } = row;
  return { ...rest, _count: { chapters: chapters.length } };
}

async function requireProject(projectId: string, user: PublicUser | null): Promise<void> {
  await authorizeProjectId(projectId, user);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new AuthError("Not found.", 404);
}

async function nextChapterOrder(projectId: string): Promise<number> {
  const agg = await prisma.chapter.aggregate({
    where: { projectId },
    _max: { order: true },
  });
  return (agg._max.order ?? -1) + 1;
}

export async function listChapters(
  projectId: string,
  user: PublicUser | null,
  opts?: { archived?: boolean }
) {
  await requireProject(projectId, user);
  const archivedOnly = opts?.archived === true;
  const rows = await prisma.chapter.findMany({
    where: {
      projectId,
      archivedAt: archivedOnly ? { not: null } : null,
    },
    orderBy: archivedOnly ? { archivedAt: "desc" } : { order: "asc" },
  });
  return ensureChaptersBlockIds(rows);
}

export async function createChapter(
  user: PublicUser | null,
  input: { projectId?: unknown; title?: unknown }
) {
  const projectId = typeof input.projectId === "string" ? input.projectId : "";
  if (!projectId) throw new AuthError("projectId required", 400);
  await requireProject(projectId, user);
  const visibleCount = await prisma.chapter.count({
    where: { projectId, ...visibleChapterWhere },
  });
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : `Chapter ${visibleCount + 1}`;
  return prisma.chapter.create({
    data: { projectId, title, order: await nextChapterOrder(projectId) },
  });
}

export type ChapterPatchInput = {
  content?: unknown;
  title?: unknown;
  summary?: unknown;
  status?: unknown;
  order?: unknown;
  expectedRevision?: unknown;
};

function metadataFromPatch(body: ChapterPatchInput): Prisma.ChapterUpdateManyMutationInput {
  const data: Prisma.ChapterUpdateManyMutationInput = {};
  if (typeof body.title === "string") data.title = body.title;
  if (typeof body.summary === "string") data.summary = body.summary;
  if (typeof body.status === "string") data.status = body.status;
  if (typeof body.order === "number") data.order = body.order;
  return data;
}

async function casUpdateChapter(
  id: string,
  expectedRevision: number,
  data: Prisma.ChapterUpdateManyMutationInput
) {
  const updated = await prisma.chapter.updateMany({
    where: { id, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  });
  const chapter = await prisma.chapter.findUnique({ where: { id } });
  if (!chapter) throw new AuthError("Not found.", 404);
  if (updated.count !== 1) {
    throw new AuthError("Chapter revision conflict", 409, {
      error: "Chapter revision conflict",
      expectedRevision,
      currentRevision: chapter.revision,
      chapter,
    });
  }
  return chapter;
}

export async function updateChapter(
  id: string,
  user: PublicUser | null,
  body: ChapterPatchInput
) {
  await authorizeOwnedChapter(id, user);
  if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    throw new AuthError("expectedRevision is required for chapter updates", 428);
  }
  const expectedRevision = body.expectedRevision as number;
  const metadata = metadataFromPatch(body);
  const contentChanged = typeof body.content === "string";

  if (!contentChanged && Object.keys(metadata).length === 0) {
    throw new AuthError("No chapter fields to update", 400);
  }

  if (contentChanged) {
    const current = await prisma.chapter.findUnique({ where: { id } });
    if (!current) throw new AuthError("Not found.", 404);
    if (current.revision !== expectedRevision) {
      throw new AuthError("Chapter revision conflict", 409, {
        error: "Chapter revision conflict",
        expectedRevision,
        currentRevision: current.revision,
        chapter: current,
      });
    }

    // One editor state is one authoring action: diffHtmlToOps groups what it
    // emits, so a split cannot land its replace and lose its insert.
    const ops = diffHtmlToOps(current.content, body.content as string, current.revision);
    if (ops.length > 0) {
      const result = await appendOps(id, user, ops, { actor: "user" });
      if (result.rejected.length > 0) {
        throw new AuthError("Chapter revision conflict", 409, {
          error: "Chapter revision conflict",
          expectedRevision,
          currentRevision: result.chapter.revision,
          chapter: result.chapter,
          rejected: result.rejected,
        });
      }
      if (Object.keys(metadata).length > 0) {
        const chapter = await prisma.chapter.update({
          where: { id },
          data: metadata,
        });
        return { chapter, contentChanged: true };
      }
      return { chapter: result.chapter, contentChanged: true };
    }

    const chapter = await casUpdateChapter(id, expectedRevision, {
      ...metadata,
      content: stampBlockIds(body.content as string),
      wordCount: countWords(htmlToText(body.content as string)),
    });
    return { chapter, contentChanged: true };
  }

  const chapter = await casUpdateChapter(id, expectedRevision, metadata);
  return { chapter, contentChanged: false };
}

export async function deleteChapter(id: string, user: PublicUser | null) {
  const chapter = await authorizeOwnedChapter(id, user);
  const row = await prisma.chapter.findUnique({ where: { id } });
  if (!row) throw new AuthError("Not found.", 404);
  if (!isChapterEmpty(row.content)) {
    throw new AuthError("Chapter must be empty to delete.", 409, {
      error: "Chapter must be empty to delete.",
      chapterId: id,
    });
  }
  await prisma.chapter.delete({ where: { id } });

  const remaining = await prisma.chapter.findMany({
    where: { projectId: chapter.projectId },
    orderBy: { order: "asc" },
  });
  await Promise.all(
    remaining.map((ch, i) =>
      prisma.chapter.update({ where: { id: ch.id }, data: { order: i } })
    )
  );
  return { ok: true as const };
}

/**
 * Put the live chapters in the order the author dragged them into. Ids the
 * client did not mention (a chapter another device just added) keep their
 * relative order at the end; archived chapters stay behind every live one.
 * Renumbers 0..n-1 the way deleteChapter does, and leaves revisions alone so
 * a reorder never turns an open editor's next save into a conflict.
 */
export async function reorderChapters(
  user: PublicUser | null,
  input: { projectId?: unknown; chapterIds?: unknown }
) {
  const projectId = typeof input.projectId === "string" ? input.projectId : "";
  if (!projectId) throw new AuthError("projectId required", 400);
  if (
    !Array.isArray(input.chapterIds) ||
    input.chapterIds.some((id) => typeof id !== "string")
  ) {
    throw new AuthError("chapterIds must be a list of chapter ids", 400);
  }
  const requested = input.chapterIds as string[];
  if (new Set(requested).size !== requested.length) {
    throw new AuthError("chapterIds must not repeat", 400);
  }
  await requireProject(projectId, user);

  const rows = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, order: true, archivedAt: true },
  });
  const live = rows.filter((row) => !row.archivedAt);
  const liveIds = new Set(live.map((row) => row.id));
  if (requested.some((id) => !liveIds.has(id))) {
    throw new AuthError("chapterIds must belong to this manuscript", 400);
  }

  const requestedSet = new Set(requested);
  const sequence = [
    ...requested,
    ...live.filter((row) => !requestedSet.has(row.id)).map((row) => row.id),
    ...rows.filter((row) => row.archivedAt).map((row) => row.id),
  ];
  await prisma.$transaction(
    sequence.map((id, i) =>
      prisma.chapter.updateMany({
        where: { id, projectId, order: { not: i } },
        data: { order: i },
      })
    )
  );
  return listChapters(projectId, user);
}

export async function archiveChapter(id: string, user: PublicUser | null) {
  await authorizeOwnedChapter(id, user);
  const chapter = await prisma.chapter.findUnique({ where: { id } });
  if (!chapter) throw new AuthError("Not found.", 404);
  if (chapter.archivedAt) return chapter;
  return prisma.chapter.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
}

export async function unarchiveChapter(id: string, user: PublicUser | null) {
  await authorizeOwnedChapter(id, user);
  const chapter = await prisma.chapter.findUnique({ where: { id } });
  if (!chapter) throw new AuthError("Not found.", 404);
  if (!chapter.archivedAt) return chapter;
  return prisma.chapter.update({
    where: { id },
    data: { archivedAt: null },
  });
}

export async function listChapterEdits(id: string, user: PublicUser | null) {
  await authorizeOwnedChapter(id, user);
  return prisma.manuscriptEdit.findMany({
    where: { chapterId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}
