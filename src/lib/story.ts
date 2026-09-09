import { prisma } from "@/lib/db";
import {
  authorizeOwnedCharacter,
  authorizeOwnedPlotPoint,
  authorizeOwnedQuestion,
} from "@/lib/auth/access";
import { AuthError, authorizeProjectId, type PublicUser } from "@/lib/auth/session";

async function requireProject(projectId: string, user: PublicUser | null): Promise<void> {
  await authorizeProjectId(projectId, user);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new AuthError("Not found.", 404);
}

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function listCharacters(projectId: string, user: PublicUser | null) {
  await requireProject(projectId, user);
  return prisma.character.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
}

export async function createCharacter(
  user: PublicUser | null,
  input: Record<string, unknown>
) {
  const projectId = typeof input.projectId === "string" ? input.projectId : "";
  const name = readTrimmed(input.name);
  if (!projectId || !name) throw new AuthError("projectId and name required", 400);
  await requireProject(projectId, user);
  return prisma.character.create({
    data: {
      projectId,
      name,
      role: readTrimmed(input.role),
      description: readTrimmed(input.description),
      arc: readTrimmed(input.arc),
      notes: readTrimmed(input.notes),
    },
  });
}

const CHARACTER_EDITABLE = ["name", "role", "description", "arc", "notes"] as const;

export async function updateCharacter(
  id: string,
  user: PublicUser | null,
  body: Record<string, unknown>
) {
  await authorizeOwnedCharacter(id, user);
  const data: Record<string, string> = {};
  for (const key of CHARACTER_EDITABLE) {
    if (typeof body[key] === "string") data[key] = body[key];
  }
  return prisma.character.update({ where: { id }, data });
}

export async function deleteCharacter(id: string, user: PublicUser | null) {
  await authorizeOwnedCharacter(id, user);
  await prisma.character.delete({ where: { id } });
  return { ok: true as const };
}

export async function listPlotPoints(projectId: string, user: PublicUser | null) {
  await requireProject(projectId, user);
  return prisma.plotPoint.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
}

export async function createPlotPoint(
  user: PublicUser | null,
  input: Record<string, unknown>
) {
  const projectId = typeof input.projectId === "string" ? input.projectId : "";
  const title = readTrimmed(input.title);
  if (!projectId || !title) throw new AuthError("projectId and title required", 400);
  await requireProject(projectId, user);
  const count = await prisma.plotPoint.count({ where: { projectId } });
  const chapterId = typeof input.chapterId === "string" && input.chapterId ? input.chapterId : null;
  return prisma.plotPoint.create({
    data: {
      projectId,
      title,
      description: readTrimmed(input.description),
      type: readTrimmed(input.type) || "beat",
      status: readTrimmed(input.status) || "open",
      chapterId,
      order: count,
    },
  });
}

export async function updatePlotPoint(
  id: string,
  user: PublicUser | null,
  body: Record<string, unknown>
) {
  await authorizeOwnedPlotPoint(id, user);
  const data: Record<string, string | null> = {};
  for (const key of ["title", "description", "type", "status"] as const) {
    if (typeof body[key] === "string") data[key] = body[key];
  }
  if ("chapterId" in body) {
    data.chapterId = typeof body.chapterId === "string" && body.chapterId ? body.chapterId : null;
  }
  return prisma.plotPoint.update({ where: { id }, data });
}

export async function deletePlotPoint(id: string, user: PublicUser | null) {
  await authorizeOwnedPlotPoint(id, user);
  await prisma.plotPoint.delete({ where: { id } });
  return { ok: true as const };
}

export async function listQuestions(
  projectId: string,
  user: PublicUser | null,
  status?: string | null
) {
  await requireProject(projectId, user);
  return prisma.openQuestion.findMany({
    where: { projectId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function createQuestion(
  user: PublicUser | null,
  input: Record<string, unknown>
) {
  const projectId = typeof input.projectId === "string" ? input.projectId : "";
  const question = readTrimmed(input.question);
  if (!projectId || !question) throw new AuthError("projectId and question required", 400);
  await requireProject(projectId, user);
  const chapterId = typeof input.chapterId === "string" && input.chapterId ? input.chapterId : null;
  return prisma.openQuestion.create({
    data: {
      projectId,
      question,
      provisional: readTrimmed(input.provisional),
      affects: readTrimmed(input.affects),
      chapterId,
    },
  });
}

export async function updateQuestion(
  id: string,
  user: PublicUser | null,
  body: Record<string, unknown>
) {
  await authorizeOwnedQuestion(id, user);
  const data: Record<string, string | null> = {};
  for (const key of [
    "question",
    "provisional",
    "affects",
    "answer",
    "resolution",
    "status",
  ] as const) {
    if (typeof body[key] === "string") data[key] = body[key];
  }
  if ("chapterId" in body) {
    data.chapterId = typeof body.chapterId === "string" && body.chapterId ? body.chapterId : null;
  }
  return prisma.openQuestion.update({ where: { id }, data });
}

export async function deleteQuestion(id: string, user: PublicUser | null) {
  await authorizeOwnedQuestion(id, user);
  await prisma.openQuestion.delete({ where: { id } });
  return { ok: true as const };
}
