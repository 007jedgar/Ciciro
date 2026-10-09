import { ciciro, queryClient, queryKeys } from "./api";
import type { ProjectCreated } from "./api/types";
import { createManuscript } from "./manuscripts";
import { exerciseHtml, type ExercisePart, type ExerciseTexts } from "./writing-exercise";

/**
 * Keeps a finished exercise as a new journal manuscript: its one dated entry
 * holds a heading and the paragraphs for each part. Nothing new on the server:
 * the same project create and chapter save every manuscript uses.
 *
 * A save that fails after the manuscript was made hands that manuscript back on
 * `existing`, so a retry only redoes the chapter write and never makes a second one.
 */
export async function keepExerciseAsManuscript({
  texts,
  labels,
  title,
  author,
  existing,
  onCreated,
}: {
  texts: ExerciseTexts;
  labels: Record<ExercisePart, string>;
  title: string;
  author: string;
  existing?: ProjectCreated | null;
  onCreated?: (project: ProjectCreated) => void;
}): Promise<ProjectCreated> {
  let project = existing ?? null;
  if (!project) {
    project = await createManuscript({ title, author, kind: "journal" });
    onCreated?.(project);
  }
  const chapter = project.chapters[0];
  if (chapter) {
    await ciciro.chapters.patch(chapter.id, {
      expectedRevision: chapter.revision,
      content: exerciseHtml(texts, labels),
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(project.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(project.id) });
  }
  return project;
}
