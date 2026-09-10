import { prisma } from "@/lib/db";
import { authorizeOwnedFolder } from "@/lib/auth/access";
import { AuthError, authorizeFolderId, authorizeProjectId, type PublicUser } from "@/lib/auth/session";

const NAME_MAX = 200;
const NOTES_MAX = 8000;

const FOLDER_PROJECT_INCLUDE = {
  orderBy: { updatedAt: "desc" as const },
  include: { _count: { select: { chapters: true } } },
};

const FOLDER_INCLUDE = {
  projects: FOLDER_PROJECT_INCLUDE,
  _count: { select: { projects: true } },
} as const;

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** Parse optional `projectIds` from a JSON body. Missing is empty; a non-array is 400. */
export function readProjectIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new AuthError("projectIds must be an array of manuscript ids.", 400);
  }
  return [
    ...new Set(
      value
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * Resolve a folder id from a create/update payload.
 * `undefined` means leave unchanged; `null` or "" means unfile.
 */
export async function resolveFolderId(
  user: PublicUser | null,
  value: unknown
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AuthError("folderId must be a string or null.", 400);
  }
  const folderId = value.trim();
  if (!folderId) return null;
  await authorizeFolderId(folderId, user);
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true },
  });
  if (!folder) throw new AuthError("Not found.", 404);
  return folder.id;
}

async function requireOwnedProjects(
  user: PublicUser | null,
  projectIds: string[]
): Promise<void> {
  for (const projectId of projectIds) {
    await authorizeProjectId(projectId, user);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new AuthError("Not found.", 404);
  }
}

async function loadFolder(id: string) {
  const folder = await prisma.folder.findUnique({
    where: { id },
    include: FOLDER_INCLUDE,
  });
  if (!folder) throw new AuthError("Not found.", 404);
  return folder;
}

/** List folders. Signed-in users only see their own; local-first lists all. */
export async function listFolders(user: PublicUser | null) {
  return prisma.folder.findMany({
    where: user ? { userId: user.id } : undefined,
    orderBy: { updatedAt: "desc" },
    include: FOLDER_INCLUDE,
  });
}

export async function getFolder(id: string, user: PublicUser | null) {
  await authorizeFolderId(id, user);
  return loadFolder(id);
}

export type FolderCreateInput = {
  name?: unknown;
  notes?: unknown;
  projectIds?: unknown;
};

export async function createFolder(user: PublicUser | null, input: FolderCreateInput = {}) {
  const name = clip(readTrimmed(input.name), NAME_MAX);
  if (!name) throw new AuthError("Name is required.", 400);
  const notes = clip(readTrimmed(input.notes), NOTES_MAX);
  const projectIds = readProjectIds(input.projectIds);
  await requireOwnedProjects(user, projectIds);

  return prisma.$transaction(async (tx) => {
    const folder = await tx.folder.create({
      data: {
        userId: user?.id ?? null,
        name,
        notes,
      },
    });
    if (projectIds.length > 0) {
      await tx.project.updateMany({
        where: { id: { in: projectIds } },
        data: { folderId: folder.id },
      });
    }
    return tx.folder.findUniqueOrThrow({
      where: { id: folder.id },
      include: FOLDER_INCLUDE,
    });
  });
}

export async function updateFolder(
  id: string,
  user: PublicUser | null,
  body: Record<string, unknown>
) {
  await authorizeOwnedFolder(id, user);
  const data: { name?: string; notes?: string } = {};
  if (typeof body.name === "string") {
    const name = clip(body.name.trim(), NAME_MAX);
    if (!name) throw new AuthError("Name is required.", 400);
    data.name = name;
  }
  if (typeof body.notes === "string") {
    data.notes = clip(body.notes.trim(), NOTES_MAX);
  }
  if (Object.keys(data).length === 0) {
    return loadFolder(id);
  }
  await prisma.folder.update({ where: { id }, data });
  return loadFolder(id);
}

export async function deleteFolder(id: string, user: PublicUser | null) {
  await authorizeOwnedFolder(id, user);
  await prisma.folder.delete({ where: { id } });
  return { ok: true as const };
}

export async function addProjectsToFolder(
  id: string,
  user: PublicUser | null,
  input: { projectIds?: unknown }
) {
  await authorizeOwnedFolder(id, user);
  const projectIds = readProjectIds(input.projectIds);
  if (projectIds.length === 0) {
    throw new AuthError("projectIds required", 400);
  }
  await requireOwnedProjects(user, projectIds);
  await prisma.project.updateMany({
    where: { id: { in: projectIds } },
    data: { folderId: id },
  });
  await prisma.folder.update({ where: { id }, data: { updatedAt: new Date() } });
  return loadFolder(id);
}

export async function removeProjectsFromFolder(
  id: string,
  user: PublicUser | null,
  input: { projectIds?: unknown }
) {
  await authorizeOwnedFolder(id, user);
  const projectIds = readProjectIds(input.projectIds);
  if (projectIds.length === 0) {
    throw new AuthError("projectIds required", 400);
  }
  await requireOwnedProjects(user, projectIds);
  await prisma.project.updateMany({
    where: { id: { in: projectIds }, folderId: id },
    data: { folderId: null },
  });
  await prisma.folder.update({ where: { id }, data: { updatedAt: new Date() } });
  return loadFolder(id);
}
