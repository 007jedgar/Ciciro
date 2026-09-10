import { ciciro, queryClient, queryKeys } from "./api";
import type { Folder } from "./types";

export type NewFolderInput = {
  name: string;
  notes?: string;
  projectIds?: string[];
};

function invalidateFolders(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
}

export async function listFolders(): Promise<Folder[]> {
  return ciciro.folders.list();
}

export async function getFolder(id: string): Promise<Folder> {
  return ciciro.folders.get(id);
}

export async function createFolder(input: NewFolderInput): Promise<Folder> {
  const folder = await ciciro.folders.create({
    name: input.name.trim(),
    notes: input.notes?.trim() ?? "",
    ...(input.projectIds?.length ? { projectIds: input.projectIds } : {}),
  });
  invalidateFolders();
  return folder;
}

export async function updateFolder(
  id: string,
  input: { name?: string; notes?: string }
): Promise<Folder> {
  const folder = await ciciro.folders.patch(id, input);
  invalidateFolders();
  return folder;
}

export async function deleteFolder(id: string): Promise<{ ok: true }> {
  const result = await ciciro.folders.delete(id);
  invalidateFolders();
  return result;
}

export async function addManuscriptsToFolder(id: string, projectIds: string[]): Promise<Folder> {
  const folder = await ciciro.folders.addProjects(id, { projectIds });
  invalidateFolders();
  return folder;
}

export async function removeManuscriptsFromFolder(
  id: string,
  projectIds: string[]
): Promise<Folder> {
  const folder = await ciciro.folders.removeProjects(id, { projectIds });
  invalidateFolders();
  return folder;
}
