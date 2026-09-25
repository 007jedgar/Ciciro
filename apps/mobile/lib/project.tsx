import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, useCreateChapterMutation, useProjectQuery } from "./api";
import type { ReplicaReadingPosition } from "./db";
import type { Chapter, ProjectDetail } from "./types";
import { useProjectSync } from "./use-project-sync";

type ProjectState = {
  project: ProjectDetail | null;
  loading: boolean;
  error: string | null;
  selectedChapterId: string | null;
  setSelectedChapterId: (id: string) => void;
  reload: () => void;
  addChapter: (title?: string) => Promise<Chapter>;
  readingPosition: ReplicaReadingPosition | null;
  recordReadingPosition: (next: {
    chapterId: string;
    blockId: string;
    offset: number;
  }) => Promise<void>;
  recordChapterOp: ReturnType<typeof useProjectSync>["recordOp"];
  flushEdits: () => Promise<boolean>;
  /**
   * Push queued edits and pull the server's, then report whether every edit
   * to `chapterId` made it to the server.
   */
  settleChapter: (chapterId: string) => Promise<boolean>;
  setEditingBlockIds: (ids: string[]) => void;
};

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const query = useProjectQuery(projectId);
  const createChapter = useCreateChapterMutation();
  const editingBlockIdsRef = useRef<string[]>([]);
  const sync = useProjectSync(projectId, { skipBlockIdsRef: editingBlockIdsRef });
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const project = query.data ?? null;
  const restoredPosition = useRef<string | null>(null);

  const setEditingBlockIds = useCallback((ids: string[]) => {
    editingBlockIdsRef.current = ids;
  }, []);

  useEffect(() => {
    if (!project) return;
    setSelectedChapterId((current) => {
      if (current && project.chapters.some((c) => c.id === current)) return current;
      return project.chapters[0]?.id ?? null;
    });
  }, [project]);

  useEffect(() => {
    const pos = sync.position;
    if (!pos) return;
    const key = `${pos.chapterId}:${pos.blockId}:${pos.offset}:${pos.updatedAt}`;
    if (restoredPosition.current === key) return;
    restoredPosition.current = key;
    setSelectedChapterId(pos.chapterId);
  }, [sync.position]);

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
        ? t("project.loadError")
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
        void sync.syncNow();
      },
      addChapter,
      readingPosition: sync.position,
      recordReadingPosition: sync.recordPosition,
      recordChapterOp: sync.recordOp,
      flushEdits: sync.flushEdits,
      settleChapter: sync.settleChapter,
      setEditingBlockIds,
    }),
    [
      addChapter,
      error,
      project,
      query.isPending,
      query.refetch,
      selectedChapterId,
      setEditingBlockIds,
      sync.flushEdits,
      sync.position,
      sync.recordOp,
      sync.recordPosition,
      sync.settleChapter,
      sync.syncNow,
    ]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
