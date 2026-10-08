import { useCallback } from "react";
import { ApiError, queryClient, queryKeys, usePatchChapterMutation, usePatchProjectMutation } from "./api";
import { useProject } from "./project";
import type { ProjectDetail } from "./types";

/**
 * Renames a chapter. A title is a plain PATCH guarded by the chapter's
 * revision, while the prose travels as queued ops, so the queue is settled
 * first and the revision read at the last moment; a conflict (an edit landing
 * from another device in between) pulls once and tries again. A blog post has
 * one title, the piece's, so it renames the manuscript too, as the web does.
 */
export function useRenameChapter(): (chapterId: string, title: string) => Promise<void> {
  const { project, settleChapter, reload } = useProject();
  const patchChapter = usePatchChapterMutation();
  const patchProject = usePatchProjectMutation();
  const projectId = project?.id ?? "";
  const isBlog = project?.kind === "blog";

  return useCallback(
    async (chapterId: string, title: string) => {
      if (!projectId) return;
      const revisionOf = () =>
        queryClient
          .getQueryData<ProjectDetail>(queryKeys.projects.detail(projectId))
          ?.chapters.find((chapter) => chapter.id === chapterId)?.revision;

      async function attempt(): Promise<void> {
        await settleChapter(chapterId);
        const expectedRevision = revisionOf();
        if (expectedRevision === undefined) throw new Error("Chapter not found");
        await patchChapter.mutateAsync({ id: chapterId, body: { expectedRevision, title } });
      }

      try {
        await attempt();
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        await reload();
        await attempt();
      }
      if (isBlog) await patchProject.mutateAsync({ id: projectId, body: { title } });
      await reload();
    },
    [isBlog, patchChapter, patchProject, projectId, reload, settleChapter]
  );
}
