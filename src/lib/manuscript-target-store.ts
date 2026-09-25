import { prisma } from "@/lib/db";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import {
  manuscriptPace,
  parseManuscriptTargetPut,
  type ManuscriptPace,
  type ManuscriptTargetTotals,
} from "@/lib/manuscript-target";

export type ManuscriptTargetRecord = ManuscriptTargetTotals & {
  pace: ManuscriptPace;
  manuscriptWords: number;
};

async function assertProjectOwner(user: PublicUser, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) throw new AuthError("Manuscript not found.", 404);
}

async function manuscriptWords(projectId: string): Promise<number> {
  const rows = await prisma.chapter.aggregate({
    where: { projectId, archivedAt: null },
    _sum: { wordCount: true },
  });
  return rows._sum.wordCount ?? 0;
}

export async function getManuscriptTarget(
  user: PublicUser | null,
  projectId: string
): Promise<ManuscriptTargetRecord | null> {
  if (!user) throw new AuthError("Authentication required.", 401);
  await assertProjectOwner(user, projectId);
  const row = await prisma.manuscriptTarget.findUnique({ where: { projectId } });
  if (!row) return null;
  const words = await manuscriptWords(projectId);
  return {
    projectId: row.projectId,
    wordGoal: row.wordGoal,
    deadline: row.deadline,
    manuscriptWords: words,
    pace: manuscriptPace(row, words),
  };
}

export async function putManuscriptTarget(
  user: PublicUser | null,
  projectId: string,
  body: unknown
): Promise<ManuscriptTargetRecord> {
  if (!user) throw new AuthError("Authentication required.", 401);
  await assertProjectOwner(user, projectId);
  const parsed = parseManuscriptTargetPut(body);
  if ("error" in parsed) throw new AuthError(parsed.error, 400);
  const row = await prisma.manuscriptTarget.upsert({
    where: { projectId },
    create: { projectId, wordGoal: parsed.wordGoal, deadline: parsed.deadline },
    update: { wordGoal: parsed.wordGoal, deadline: parsed.deadline },
  });
  const words = await manuscriptWords(projectId);
  return {
    projectId: row.projectId,
    wordGoal: row.wordGoal,
    deadline: row.deadline,
    manuscriptWords: words,
    pace: manuscriptPace(row, words),
  };
}

export async function deleteManuscriptTarget(
  user: PublicUser | null,
  projectId: string
): Promise<void> {
  if (!user) throw new AuthError("Authentication required.", 401);
  await assertProjectOwner(user, projectId);
  await prisma.manuscriptTarget.deleteMany({ where: { projectId } });
}
