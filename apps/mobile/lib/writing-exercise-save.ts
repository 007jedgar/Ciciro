import { ciciro, queryClient, queryKeys } from "./api";
import type { ProjectCreated } from "./api/types";
import { createManuscript } from "./manuscripts";
import { exerciseHtml, type ExerciseDef, type ExerciseTexts } from "./writing-exercise";

/**
 * Keeps a finished exercise as a new journal manuscript: its one dated entry
 * holds the paragraphs for each part, under a heading each when the exercise
 * has several. Nothing new on the server:
 * the same project create and chapter save every manuscript uses.
 *
 * A save that fails after the manuscript was made hands that manuscript back on
 * `existing`, so a retry only redoes the chapter write and never makes a second one.
 * The retry reads the entry's current revision first: a write whose answer was
 * lost may still have landed, and the revision from the create would be stale.
 */
export async function keepExerciseAsManuscript({
  exercise,
  texts,
  labels,
  title,
  author,
  existing,
  onCreated,
}: {
  exercise: ExerciseDef;
  texts: ExerciseTexts;
  labels: Record<string, string>;
  title: string;
  author: string;
  existing?: ProjectCreated | null;
  onCreated?: (project: ProjectCreated) => void;
}): Promise<ProjectCreated> {
  let project = existing ?? null;
  let revision: number | undefined;
  if (project) {
    const first = project.chapters[0];
    if (first) revision = (await ciciro.chapters.list(project.id)).find((c) => c.id === first.id)?.revision;
  } else {
    project = await createManuscript({ title, author, kind: "journal" });
    onCreated?.(project);
  }
  const chapter = project.chapters[0];
  if (chapter) {
    await ciciro.chapters.patch(chapter.id, {
      expectedRevision: revision ?? chapter.revision,
      content: exerciseHtml(exercise, texts, labels),
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(project.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(project.id) });
  }
  return project;
}
