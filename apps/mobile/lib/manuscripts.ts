import { ciciro, queryClient, queryKeys } from "./api";
import type { Chapter, ProjectCreated, ProjectDetail, ProjectListItem } from "./api/types";

export type NewManuscriptInput = {
  title: string;
  author: string;
  genre?: string;
  logline?: string;
  folderId?: string | null;
};

export async function listManuscripts(): Promise<ProjectListItem[]> {
  return ciciro.projects.list();
}

export async function createManuscript(input: NewManuscriptInput): Promise<ProjectCreated> {
  const project = await ciciro.projects.create({
    title: input.title.trim(),
    author: input.author.trim(),
    genre: input.genre?.trim() ?? "",
    logline: input.logline?.trim() ?? "",
    ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
  return project;
}

export async function getManuscript(id: string): Promise<ProjectDetail> {
  return ciciro.projects.get(id);
}

export async function addChapter(projectId: string, title?: string): Promise<Chapter> {
  const chapter = await ciciro.chapters.create({
    projectId,
    ...(title?.trim() ? { title: title.trim() } : {}),
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(projectId) });
  return chapter;
}
