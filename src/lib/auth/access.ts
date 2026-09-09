import { prisma } from "@/lib/db";
import {
  AuthError,
  authorizeProjectId,
  getSessionUser,
  type PublicUser,
} from "@/lib/auth/session";

async function resolvedUser(user?: PublicUser | null): Promise<PublicUser | null> {
  return user === undefined ? getSessionUser() : user;
}

export async function authorizeOwnedProject(
  projectId: string,
  user?: PublicUser | null
): Promise<void> {
  await authorizeProjectId(projectId, await resolvedUser(user));
}

export async function authorizeOwnedChapter(
  chapterId: string,
  user?: PublicUser | null
): Promise<{ id: string; projectId: string }> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, projectId: true },
  });
  if (!chapter) throw new AuthError("Not found.", 404);
  await authorizeProjectId(chapter.projectId, await resolvedUser(user));
  return chapter;
}

export async function authorizeOwnedCharacter(
  characterId: string,
  user?: PublicUser | null
): Promise<{ id: string; projectId: string }> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, projectId: true },
  });
  if (!character) throw new AuthError("Not found.", 404);
  await authorizeProjectId(character.projectId, await resolvedUser(user));
  return character;
}

export async function authorizeOwnedPlotPoint(
  plotPointId: string,
  user?: PublicUser | null
): Promise<{ id: string; projectId: string }> {
  const point = await prisma.plotPoint.findUnique({
    where: { id: plotPointId },
    select: { id: true, projectId: true },
  });
  if (!point) throw new AuthError("Not found.", 404);
  await authorizeProjectId(point.projectId, await resolvedUser(user));
  return point;
}

export async function authorizeOwnedQuestion(
  questionId: string,
  user?: PublicUser | null
): Promise<{ id: string; projectId: string }> {
  const question = await prisma.openQuestion.findUnique({
    where: { id: questionId },
    select: { id: true, projectId: true },
  });
  if (!question) throw new AuthError("Not found.", 404);
  await authorizeProjectId(question.projectId, await resolvedUser(user));
  return question;
}
