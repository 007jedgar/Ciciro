import { prisma } from "@/lib/db";
import { authorizeProjectId, AuthError, type PublicUser } from "@/lib/auth/session";

export type ReadingPositionRecord = {
  projectId: string;
  chapterId: string;
  blockId: string;
  offset: number;
  updatedAt: Date;
};

export type ReadingPositionInput = {
  chapterId?: unknown;
  blockId?: unknown;
  offset?: unknown;
};

async function requireOwnedProject(projectId: string, user: PublicUser | null) {
  await authorizeProjectId(projectId, user);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new AuthError("Not found.", 404);
}

export async function getReadingPosition(
  projectId: string,
  user: PublicUser | null
): Promise<ReadingPositionRecord | null> {
  await requireOwnedProject(projectId, user);
  if (!user) return null;
  const row = await prisma.readingPosition.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
  });
  if (!row) return null;
  return {
    projectId: row.projectId,
    chapterId: row.chapterId,
    blockId: row.blockId,
    offset: row.offset,
    updatedAt: row.updatedAt,
  };
}

export async function putReadingPosition(
  projectId: string,
  user: PublicUser | null,
  body: ReadingPositionInput
): Promise<ReadingPositionRecord> {
  await requireOwnedProject(projectId, user);
  if (!user) throw new AuthError("Authentication required.", 401);

  const chapterId = typeof body.chapterId === "string" ? body.chapterId.trim() : "";
  const blockId = typeof body.blockId === "string" ? body.blockId.trim() : "";
  const offset = body.offset;
  if (!chapterId) throw new AuthError("chapterId required", 400);
  if (!blockId) throw new AuthError("blockId required", 400);
  if (!Number.isInteger(offset) || (offset as number) < 0) {
    throw new AuthError("offset must be a non-negative integer", 400);
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, projectId: true },
  });
  if (!chapter || chapter.projectId !== projectId) {
    throw new AuthError("Not found.", 404);
  }

  const row = await prisma.readingPosition.upsert({
    where: { userId_projectId: { userId: user.id, projectId } },
    create: {
      userId: user.id,
      projectId,
      chapterId,
      blockId,
      offset: offset as number,
    },
    update: {
      chapterId,
      blockId,
      offset: offset as number,
    },
  });
  return {
    projectId: row.projectId,
    chapterId: row.chapterId,
    blockId: row.blockId,
    offset: row.offset,
    updatedAt: row.updatedAt,
  };
}
