import { api } from "./api";
import type { Chapter, ProjectDetail, ProjectListItem } from "./types";

export type NewManuscriptInput = {
  title: string;
  author: string;
  genre?: string;
  logline?: string;
};

export async function listManuscripts(): Promise<ProjectListItem[]> {
  return api<ProjectListItem[]>("/api/projects");
}

export async function createManuscript(input: NewManuscriptInput): Promise<ProjectDetail> {
  return api<ProjectDetail>("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      title: input.title.trim(),
      author: input.author.trim(),
      genre: input.genre?.trim() ?? "",
      logline: input.logline?.trim() ?? "",
    }),
  });
}

export async function getManuscript(id: string): Promise<ProjectDetail> {
  return api<ProjectDetail>(`/api/projects/${id}`);
}

export async function addChapter(projectId: string, title?: string): Promise<Chapter> {
  return api<Chapter>("/api/chapters", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      ...(title?.trim() ? { title: title.trim() } : {}),
    }),
  });
}
