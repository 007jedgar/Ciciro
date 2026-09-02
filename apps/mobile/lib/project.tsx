import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { ProjectDetail } from "./types";

type ProjectState = {
  project: ProjectDetail | null;
  loading: boolean;
  error: string | null;
  selectedChapterId: string | null;
  setSelectedChapterId: (id: string) => void;
  reload: () => void;
};

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ProjectDetail>(`/api/projects/${projectId}`)
      .then((data) => {
        if (cancelled) return;
        setProject(data);
        setSelectedChapterId((current) => {
          if (current && data.chapters.some((c) => c.id === current)) return current;
          return data.chapters[0]?.id ?? null;
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load manuscript.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, tick]);

  const value = useMemo(
    () => ({
      project,
      loading,
      error,
      selectedChapterId,
      setSelectedChapterId,
      reload: () => setTick((n) => n + 1),
    }),
    [project, loading, error, selectedChapterId]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
