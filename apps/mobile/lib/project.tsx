import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, useCreateChapterMutation, useProjectQuery } from "./api";
import type { Chapter, ProjectDetail } from "./types";

type ProjectState = {
  project: ProjectDetail | null;
  loading: boolean;
  error: string | null;
  selectedChapterId: string | null;
  setSelectedChapterId: (id: string) => void;
  reload: () => void;
  addChapter: (title?: string) => Promise<Chapter>;
};

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const query = useProjectQuery(projectId);
  const createChapter = useCreateChapterMutation();
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const project = query.data ?? null;

  useEffect(() => {
    if (!project) return;
    setSelectedChapterId((current) => {
      if (current && project.chapters.some((c) => c.id === current)) return current;
      return project.chapters[0]?.id ?? null;
    });
  }, [project]);

  const addChapter = useCallback(
    async (title?: string) => {
      const chapter = await createChapter.mutateAsync({
        projectId,
        ...(title?.trim() ? { title: title.trim() } : {}),
      });
      setSelectedChapterId(chapter.id);
      return chapter;
    },
    [createChapter, projectId]
  );

  const error =
    query.error instanceof ApiError
      ? query.error.message
      : query.error
        ? "Could not load manuscript."
        : null;

  const value = useMemo(
    () => ({
      project,
      loading: query.isPending,
      error,
      selectedChapterId,
      setSelectedChapterId,
      reload: () => {
        void query.refetch();
      },
      addChapter,
    }),
    [project, query, error, selectedChapterId, addChapter]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
