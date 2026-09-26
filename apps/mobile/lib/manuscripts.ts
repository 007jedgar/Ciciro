import { ciciro, queryClient, queryKeys } from "./api";
import { localYmd, type ManuscriptKind } from "./manuscript-kind";
import type { Chapter, OkResponse, ProjectCreated, ProjectDetail, ProjectListItem } from "./api/types";

export type NewManuscriptInput = {
  title: string;
  author: string;
  genre?: string;
  logline?: string;
  folderId?: string | null;
  kind?: ManuscriptKind;
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
    ...(input.kind && input.kind !== "novel" ? { kind: input.kind, today: localYmd() } : {}),
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

function invalidateChapterCaches(projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.archived(projectId) });
}

/** Hard-delete an empty chapter. Non-empty chapters return 409. */
export async function deleteChapter(id: string, projectId: string): Promise<OkResponse> {
  const result = await ciciro.chapters.delete(id);
  invalidateChapterCaches(projectId);
  return result;
}

/** Hide a chapter. Any chapter can be archived. */
export async function archiveChapter(id: string, projectId: string): Promise<Chapter> {
  const chapter = await ciciro.chapters.archive(id);
  invalidateChapterCaches(projectId);
  return chapter;
}

/** Restore a hidden chapter to the live list. */
export async function unarchiveChapter(id: string, projectId: string): Promise<Chapter> {
  const chapter = await ciciro.chapters.unarchive(id);
  invalidateChapterCaches(projectId);
  return chapter;
}

export async function listArchivedChapters(projectId: string): Promise<Chapter[]> {
  return ciciro.chapters.listArchived(projectId);
}
