import { prisma } from "@/lib/db";
import { AuthError, authorizeProjectId, requireUserIfHosted, type PublicUser } from "@/lib/auth/session";
import { visibleChapterWhere, visibleChaptersInclude } from "@/lib/chapters";
import { resolveFolderId } from "@/lib/folders";

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type ProjectCreateInput = {
  title?: unknown;
  author?: unknown;
  genre?: unknown;
  logline?: unknown;
  folderId?: unknown;
};

const PROJECT_LIST_INCLUDE = {
  _count: { select: { chapters: { where: visibleChapterWhere } } },
} as const;

const PROJECT_DETAIL_INCLUDE = {
  chapters: visibleChaptersInclude,
  characters: { orderBy: { name: "asc" as const } },
  plotPoints: { orderBy: { order: "asc" as const } },
};

export const PROJECT_EDITABLE = [
  "title",
  "author",
  "genre",
  "logline",
  "synopsis",
  "theme",
  "pov",
  "notes",
] as const;

/** List manuscripts. Signed-in users only see their own; local-first lists all. */
export async function listProjects(user: PublicUser | null) {
  requireUserIfHosted(user);
  return prisma.project.findMany({
    where: user ? { userId: user.id } : undefined,
    orderBy: { updatedAt: "desc" },
    include: PROJECT_LIST_INCLUDE,
  });
}

/** Create a manuscript with an opening chapter. Owned when a user is present. */
export async function createProject(
  user: PublicUser | null,
  input: ProjectCreateInput = {}
) {
  requireUserIfHosted(user);
  const folderId = await resolveFolderId(user, input.folderId);
  return prisma.project.create({
    data: {
      userId: user?.id ?? null,
      folderId: folderId ?? null,
      title: readTrimmed(input.title) || "Untitled Manuscript",
      author: readTrimmed(input.author) || user?.name || "",
      genre: readTrimmed(input.genre),
      logline: readTrimmed(input.logline),
      chapters: {
        create: [{ title: "Chapter 1", order: 0 }],
      },
    },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
}

export async function getProject(id: string, user: PublicUser | null) {
  await authorizeProjectId(id, user);
  const project = await prisma.project.findUnique({
    where: { id },
    include: PROJECT_DETAIL_INCLUDE,
  });
  if (!project) throw new AuthError("Not found.", 404);
  return project;
}

export async function updateProject(
  id: string,
  user: PublicUser | null,
  body: Record<string, unknown>
) {
  await authorizeProjectId(id, user);
  const existing = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw new AuthError("Not found.", 404);
  const data: { [key: string]: string | null } = {};
  for (const key of PROJECT_EDITABLE) {
    if (typeof body[key] === "string") data[key] = body[key];
  }
  if ("folderId" in body) {
    const folderId = await resolveFolderId(user, body.folderId);
    if (folderId !== undefined) data.folderId = folderId;
  }
  return prisma.project.update({ where: { id }, data });
}

export async function deleteProject(id: string, user: PublicUser | null) {
  await authorizeProjectId(id, user);
  const existing = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw new AuthError("Not found.", 404);
  await prisma.project.delete({ where: { id } });
  return { ok: true as const };
}
