import { useMutation, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "./keys";
import { queryClient } from "./query";
import { ciciro } from "./resources";
import type {
  BibleFile,
  BibleNewCharacterRequest,
  BibleNewPlotRequest,
  BibleWriteRequest,
  BibleWriteResult,
  Chapter,
  ChapterCreateRequest,
  Character,
  CharacterCreateRequest,
  DraftInsertionCreateRequest,
  Folder,
  FolderCreateRequest,
  LoginRequest,
  PlotPoint,
  PlotPointCreateRequest,
  ProjectCreateRequest,
  ProjectDetail,
  ProjectListItem,
  QuestionCreateRequest,
  SettingsResponse,
  SignupRequest,
  ChapterOpsPushRequest,
  ReadingPositionPutRequest,
  SyncAfter,
  SyncPushRequest,
} from "./types";
import type { AppSettings, SettingsPatch } from "../app-settings";
import { stampChapterMetadata } from "../chapter-metadata";
import { overlayReplicaChapters } from "../editor-session";
import i18n from "../i18n";
import { sqliteReplica } from "../replica-sqlite";
import { Platform } from "react-native";

type Enabled = { enabled?: boolean };

type QueryKeyArr = readonly unknown[];
type CacheEntry = [QueryKeyArr, unknown];

/** Cancel in-flight fetches for these keys and snapshot their data for rollback. */
async function snapshotQueries(keys: readonly QueryKeyArr[]): Promise<CacheEntry[]> {
  await Promise.all(keys.map((key) => queryClient.cancelQueries({ queryKey: key })));
  return keys.map((key) => [key, queryClient.getQueryData(key)]);
}

function restoreQueries(entries: CacheEntry[] | undefined): void {
  if (!entries) return;
  for (const [key, data] of entries) queryClient.setQueryData(key, data);
}

function tempId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextChapterOrder(chapters: Chapter[]): number {
  return (
    chapters.reduce((max, c) => (typeof c.order === "number" && c.order > max ? c.order : max), -1) + 1
  );
}

/** A stand-in chapter shown instantly, replaced by the server row on success. */
function optimisticChapter(projectId: string, order: number, title?: string): Chapter {
  const now = new Date().toISOString();
  return {
    id: tempId("chapter"),
    projectId,
    title: title?.trim() || i18n.t("chapters.newTitle"),
    order,
    content: "",
    summary: "",
    status: "",
    wordCount: 0,
    revision: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// Folder <-> project membership helpers for optimistic moves.
function setProjectsFolder(
  list: ProjectListItem[] | undefined,
  projectIds: string[],
  folderId: string | null
): ProjectListItem[] | undefined {
  if (!list) return list;
  const ids = new Set(projectIds);
  return list.map((p) => (ids.has(p.id) ? { ...p, folderId } : p));
}

function withFolderProjects(folder: Folder, projects: ProjectListItem[]): Folder {
  return { ...folder, projects, _count: { ...folder._count, projects: projects.length } };
}

function addToFolder(folder: Folder, items: ProjectListItem[]): Folder {
  const existing = new Set(folder.projects.map((p) => p.id));
  const additions = items
    .filter((p) => !existing.has(p.id))
    .map((p) => ({ ...p, folderId: folder.id }));
  return withFolderProjects(folder, [...folder.projects, ...additions]);
}

function removeFromFolder(folder: Folder, projectIds: string[]): Folder {
  const ids = new Set(projectIds);
  return withFolderProjects(
    folder,
    folder.projects.filter((p) => !ids.has(p.id))
  );
}

function updateFolderInList(id: string, apply: (folder: Folder) => Folder): void {
  queryClient.setQueryData<Folder[]>(queryKeys.folders.list(), (list) =>
    list?.map((f) => (f.id === id ? apply(f) : f))
  );
}

function invalidateProject(projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
}

function invalidateChapterLists(projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.archived(projectId) });
}

function withoutChapter(current: ProjectDetail | undefined, chapterId: string) {
  if (!current) return current;
  return { ...current, chapters: current.chapters.filter((c) => c.id !== chapterId) };
}

function withLiveChapter(current: ProjectDetail | undefined, chapter: Chapter) {
  if (!current) return current;
  const chapters = current.chapters.filter((c) => c.id !== chapter.id);
  chapters.push(chapter);
  chapters.sort((a, b) => a.order - b.order);
  return { ...current, chapters };
}

function invalidateFolders(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.folders.all });
}

export function useHealthQuery(options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => ciciro.health.get(),
    enabled: options?.enabled ?? true,
  });
}

export function useMeQuery(options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => ciciro.auth.me(),
    enabled: options?.enabled ?? true,
  });
}

export function useSettingsQuery(options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => ciciro.settings.get(),
    enabled: options?.enabled ?? true,
  });
}

export function useWritingDaysQuery(
  from: string,
  to: string,
  options?: Enabled
) {
  return useQuery({
    queryKey: queryKeys.writing.days(from, to),
    queryFn: () => ciciro.writing.days.get(from, to),
    enabled: (options?.enabled ?? true) && Boolean(from && to),
  });
}

export function useProjectsQuery(
  options?: Enabled & Pick<UseQueryOptions<ProjectListItem[]>, "staleTime">
) {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: () => ciciro.projects.list(),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime,
  });
}

/** The server payload with the replica laid over it where the replica is as new or newer. */
export async function fetchProjectWithReplica(id: string): Promise<ProjectDetail> {
  const project = await ciciro.projects.get(id);
  if (Platform.OS === "web") return project;
  try {
    const snapshots = await sqliteReplica.listChapters(id);
    if (snapshots.length === 0) return project;
    return { ...project, chapters: overlayReplicaChapters(project.chapters, snapshots) };
  } catch {
    return project;
  }
}

export function useProjectQuery(id: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => fetchProjectWithReplica(id),
    enabled: (options?.enabled ?? true) && Boolean(id),
  });
}

export function useFoldersQuery(options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.folders.list(),
    queryFn: () => ciciro.folders.list(),
    enabled: options?.enabled ?? true,
  });
}

export function useFolderQuery(id: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.folders.detail(id),
    queryFn: () => ciciro.folders.get(id),
    enabled: (options?.enabled ?? true) && Boolean(id),
    // Paint instantly from the list cache, then revalidate. Tying the timestamp
    // to the list fetch keeps staleTime honest so a stale seed still refetches.
    initialData: () =>
      queryClient.getQueryData<Folder[]>(queryKeys.folders.list())?.find((f) => f.id === id),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(queryKeys.folders.list())?.dataUpdatedAt,
  });
}

export function useChaptersQuery(projectId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chapters.list(projectId),
    queryFn: () => ciciro.chapters.list(projectId),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function useArchivedChaptersQuery(projectId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chapters.archived(projectId),
    queryFn: () => ciciro.chapters.listArchived(projectId),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function useChapterEditsQuery(id: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chapters.edits(id),
    queryFn: () => ciciro.chapters.edits(id),
    enabled: (options?.enabled ?? true) && Boolean(id),
  });
}

export function useChapterSnapshotsQuery(id: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chapters.snapshots(id),
    queryFn: () => ciciro.chapters.snapshots.list(id).then((res) => res.snapshots),
    enabled: (options?.enabled ?? true) && Boolean(id),
  });
}

export function useChapterSnapshotQuery(id: string, snapshotId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chapters.snapshot(id, snapshotId),
    queryFn: () => ciciro.chapters.snapshots.get(id, snapshotId),
    enabled: (options?.enabled ?? true) && Boolean(id) && Boolean(snapshotId),
    // A snapshot's text never changes after it is taken.
    staleTime: Infinity,
  });
}

function invalidateSnapshots(chapterId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.snapshots(chapterId), exact: true });
}

export function useSaveSnapshotMutation() {
  return useMutation({
    mutationFn: ({ chapterId, label }: { chapterId: string; label?: string }) =>
      ciciro.chapters.snapshots.create(chapterId, label ? { label } : {}),
    onSuccess: (_snapshot, vars) => invalidateSnapshots(vars.chapterId),
  });
}

export function useDeleteSnapshotMutation() {
  return useMutation({
    mutationFn: ({ chapterId, snapshotId }: { chapterId: string; snapshotId: string }) =>
      ciciro.chapters.snapshots.delete(chapterId, snapshotId),
    onSettled: (_data, _err, vars) => invalidateSnapshots(vars.chapterId),
  });
}

/**
 * The restored text reaches this device the way any other edit does: as ops
 * the sync engine pulls into the replica. The caller runs that pull; writing
 * the returned chapter into the cache here would put the screen ahead of the
 * replica it is supposed to mirror.
 */
export function useRestoreSnapshotMutation() {
  return useMutation({
    mutationFn: ({ chapterId, snapshotId }: { chapterId: string; snapshotId: string }) =>
      ciciro.chapters.snapshots.restore(chapterId, snapshotId),
    onSettled: (_data, _err, vars) => invalidateSnapshots(vars.chapterId),
  });
}

export function useCharactersQuery(projectId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.characters(projectId),
    queryFn: () => ciciro.characters.list(projectId),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function usePlotPointsQuery(projectId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.plotPoints(projectId),
    queryFn: () => ciciro.plotPoints.list(projectId),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function useQuestionsQuery(projectId: string, status?: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.questions.list(projectId, status),
    queryFn: () => ciciro.questions.list(projectId, status),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function useBibleIndexQuery(projectId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.bible.index(projectId),
    queryFn: () => ciciro.bible.list(projectId),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function useBibleFileQuery(projectId: string, path: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.bible.file(projectId, path),
    queryFn: () => ciciro.bible.read(projectId, path),
    enabled: (options?.enabled ?? true) && Boolean(projectId) && Boolean(path),
  });
}

export function useChatSnapshotQuery(projectId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chat.snapshot(projectId),
    queryFn: () => ciciro.chat.get(projectId),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function useDraftInsertionsQuery(projectId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chat.insertions(projectId),
    queryFn: () => ciciro.chat.insertions.list(projectId),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function useLoginMutation() {
  return useMutation({
    mutationFn: (body: LoginRequest) => ciciro.auth.login(body),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useSignupMutation() {
  return useMutation({
    mutationFn: (body: SignupRequest) => ciciro.auth.signup(body),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}

export function useLogoutMutation() {
  return useMutation({
    mutationFn: () => ciciro.auth.logout(),
    onSettled: () => {
      queryClient.clear();
    },
  });
}

export function usePatchSettingsMutation() {
  return useMutation({
    mutationFn: (body: SettingsPatch) => ciciro.settings.patch(body),
    onSuccess: (data: SettingsResponse) => {
      queryClient.setQueryData(queryKeys.settings, data);
    },
  });
}

export function useReplaceSettingsMutation() {
  return useMutation({
    mutationFn: (body: AppSettings) => ciciro.settings.put(body),
    onSuccess: (data: SettingsResponse) => {
      queryClient.setQueryData(queryKeys.settings, data);
    },
  });
}

export function useCreateProjectMutation() {
  return useMutation({
    mutationFn: (body: ProjectCreateRequest) => ciciro.projects.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

export function usePatchProjectMutation() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof ciciro.projects.patch>[1] }) =>
      ciciro.projects.patch(id, body),
    onSuccess: (_data, vars) => {
      invalidateProject(vars.id);
      invalidateFolders();
    },
  });
}

export function useDeleteProjectMutation() {
  return useMutation({
    mutationFn: (id: string) => ciciro.projects.delete(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.projects.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      invalidateFolders();
    },
  });
}

export function useCreateFolderMutation() {
  return useMutation({
    mutationFn: (body: FolderCreateRequest) => ciciro.folders.create(body),
    onSuccess: () => {
      invalidateFolders();
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

export function usePatchFolderMutation() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof ciciro.folders.patch>[1] }) =>
      ciciro.folders.patch(id, body),
    onMutate: async ({ id, body }) => {
      const snapshot = await snapshotQueries([
        queryKeys.folders.detail(id),
        queryKeys.folders.list(),
      ]);
      const patch = (f: Folder): Folder => ({
        ...f,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      });
      queryClient.setQueryData<Folder>(queryKeys.folders.detail(id), (f) => (f ? patch(f) : f));
      updateFolderInList(id, patch);
      return { snapshot };
    },
    onError: (_e, _vars, ctx) => restoreQueries(ctx?.snapshot),
    onSuccess: (folder: Folder) => {
      queryClient.setQueryData(queryKeys.folders.detail(folder.id), folder);
    },
    onSettled: () => invalidateFolders(),
  });
}

export function useDeleteFolderMutation() {
  return useMutation({
    mutationFn: (id: string) => ciciro.folders.delete(id),
    onMutate: async (id) => {
      const snapshot = await snapshotQueries([
        queryKeys.folders.list(),
        queryKeys.projects.list(),
      ]);
      queryClient.setQueryData<Folder[]>(queryKeys.folders.list(), (list) =>
        list?.filter((f) => f.id !== id)
      );
      // Manuscripts in the deleted folder fall back to unfiled.
      queryClient.setQueryData<ProjectListItem[]>(queryKeys.projects.list(), (list) =>
        list?.map((p) => (p.folderId === id ? { ...p, folderId: null } : p))
      );
      return { snapshot };
    },
    onError: (_e, _id, ctx) => restoreQueries(ctx?.snapshot),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.folders.detail(id) });
    },
    onSettled: () => {
      invalidateFolders();
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

export function useAddProjectsToFolderMutation() {
  return useMutation({
    mutationFn: ({
      id,
      projectIds,
    }: {
      id: string;
      projectIds: string[];
    }) => ciciro.folders.addProjects(id, { projectIds }),
    onMutate: async ({ id, projectIds }) => {
      const snapshot = await snapshotQueries([
        queryKeys.folders.detail(id),
        queryKeys.folders.list(),
        queryKeys.projects.list(),
      ]);
      const moved = (
        queryClient.getQueryData<ProjectListItem[]>(queryKeys.projects.list()) ?? []
      ).filter((p) => projectIds.includes(p.id));
      queryClient.setQueryData<Folder>(queryKeys.folders.detail(id), (f) =>
        f ? addToFolder(f, moved) : f
      );
      updateFolderInList(id, (f) => addToFolder(f, moved));
      queryClient.setQueryData<ProjectListItem[]>(queryKeys.projects.list(), (list) =>
        setProjectsFolder(list, projectIds, id)
      );
      return { snapshot };
    },
    onError: (_e, _vars, ctx) => restoreQueries(ctx?.snapshot),
    onSuccess: (folder: Folder) => {
      queryClient.setQueryData(queryKeys.folders.detail(folder.id), folder);
    },
    onSettled: () => {
      invalidateFolders();
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

export function useRemoveProjectsFromFolderMutation() {
  return useMutation({
    mutationFn: ({
      id,
      projectIds,
    }: {
      id: string;
      projectIds: string[];
    }) => ciciro.folders.removeProjects(id, { projectIds }),
    onMutate: async ({ id, projectIds }) => {
      const snapshot = await snapshotQueries([
        queryKeys.folders.detail(id),
        queryKeys.folders.list(),
        queryKeys.projects.list(),
      ]);
      queryClient.setQueryData<Folder>(queryKeys.folders.detail(id), (f) =>
        f ? removeFromFolder(f, projectIds) : f
      );
      updateFolderInList(id, (f) => removeFromFolder(f, projectIds));
      queryClient.setQueryData<ProjectListItem[]>(queryKeys.projects.list(), (list) =>
        setProjectsFolder(list, projectIds, null)
      );
      return { snapshot };
    },
    onError: (_e, _vars, ctx) => restoreQueries(ctx?.snapshot),
    onSuccess: (folder: Folder) => {
      queryClient.setQueryData(queryKeys.folders.detail(folder.id), folder);
    },
    onSettled: () => {
      invalidateFolders();
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

export function useCreateChapterMutation() {
  return useMutation({
    mutationFn: (body: ChapterCreateRequest) => ciciro.chapters.create(body),
    onMutate: async ({ projectId, title }) => {
      const key = queryKeys.projects.detail(projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ProjectDetail>(key);
      let tempChapterId: string | null = null;
      if (previous) {
        const optimistic = optimisticChapter(projectId, nextChapterOrder(previous.chapters), title);
        tempChapterId = optimistic.id;
        queryClient.setQueryData<ProjectDetail>(key, {
          ...previous,
          chapters: [...previous.chapters, optimistic],
        });
      }
      return { previous, tempChapterId };
    },
    onError: (_e, vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKeys.projects.detail(vars.projectId), ctx.previous);
    },
    onSuccess: (chapter, vars, ctx) => {
      queryClient.setQueryData(
        queryKeys.projects.detail(vars.projectId),
        (current: ProjectDetail | undefined) => {
          if (!current) return current;
          const chapters = current.chapters.filter(
            (c) => c.id !== ctx?.tempChapterId && c.id !== chapter.id
          );
          chapters.push(chapter);
          return { ...current, chapters };
        }
      );
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(vars.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

export function usePatchChapterMutation() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof ciciro.chapters.patch>[1] }) =>
      ciciro.chapters.patch(id, body),
    onSuccess: async (chapter: Chapter) => {
      invalidateProject(chapter.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(chapter.projectId) });
      queryClient.setQueryData<ProjectDetail>(queryKeys.projects.detail(chapter.projectId), (current) => {
        if (!current) return current;
        return {
          ...current,
          chapters: current.chapters.map((item) =>
            item.id === chapter.id
              ? {
                  ...item,
                  title: chapter.title,
                  summary: chapter.summary,
                  status: chapter.status,
                  revision: chapter.revision,
                }
              : item
          ),
        };
      });
      if (Platform.OS === "web") return;
      try {
        await stampChapterMetadata(sqliteReplica, chapter);
      } catch {
        /* replica is optional in tests and on web */
      }
    },
  });
}

export function useDeleteChapterMutation() {
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => ciciro.chapters.delete(id),
    onMutate: async ({ id, projectId }) => {
      const key = queryKeys.projects.detail(projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ProjectDetail>(key);
      queryClient.setQueryData<ProjectDetail>(key, (current) => withoutChapter(current, id));
      return { previous };
    },
    onError: (_e, vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKeys.projects.detail(vars.projectId), ctx.previous);
    },
    onSettled: (_data, _err, vars) => invalidateChapterLists(vars.projectId),
  });
}

export function useArchiveChapterMutation() {
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => ciciro.chapters.archive(id),
    onMutate: async ({ id, projectId }) => {
      const key = queryKeys.projects.detail(projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ProjectDetail>(key);
      queryClient.setQueryData<ProjectDetail>(key, (current) => withoutChapter(current, id));
      return { previous };
    },
    onError: (_e, vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKeys.projects.detail(vars.projectId), ctx.previous);
    },
    onSettled: (_data, _err, vars) => invalidateChapterLists(vars.projectId),
  });
}

export function useUnarchiveChapterMutation() {
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      ciciro.chapters.unarchive(id).then((chapter) => ({ chapter, projectId })),
    onSuccess: ({ chapter }, vars) => {
      queryClient.setQueryData(
        queryKeys.projects.detail(vars.projectId),
        (current: ProjectDetail | undefined) => withLiveChapter(current, chapter)
      );
      invalidateChapterLists(vars.projectId);
    },
  });
}

export function useCreateCharacterMutation() {
  return useMutation({
    mutationFn: (body: CharacterCreateRequest) => ciciro.characters.create(body),
    onSuccess: (_data: Character, vars) => {
      invalidateProject(vars.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters(vars.projectId) });
    },
  });
}

export function usePatchCharacterMutation() {
  return useMutation({
    mutationFn: ({
      id,
      projectId,
      body,
    }: {
      id: string;
      projectId: string;
      body: Parameters<typeof ciciro.characters.patch>[1];
    }) => ciciro.characters.patch(id, body).then((row) => ({ row, projectId })),
    onSuccess: (_data, vars) => {
      invalidateProject(vars.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters(vars.projectId) });
    },
  });
}

export function useDeleteCharacterMutation() {
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      ciciro.characters.delete(id).then((result) => ({ ...result, projectId })),
    onSuccess: (_data, vars) => {
      invalidateProject(vars.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.characters(vars.projectId) });
    },
  });
}

export function useCreatePlotPointMutation() {
  return useMutation({
    mutationFn: (body: PlotPointCreateRequest) => ciciro.plotPoints.create(body),
    onSuccess: (_data: PlotPoint, vars) => {
      invalidateProject(vars.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.plotPoints(vars.projectId) });
    },
  });
}

export function usePatchPlotPointMutation() {
  return useMutation({
    mutationFn: ({
      id,
      projectId,
      body,
    }: {
      id: string;
      projectId: string;
      body: Parameters<typeof ciciro.plotPoints.patch>[1];
    }) => ciciro.plotPoints.patch(id, body),
    onSuccess: (_data, vars) => {
      invalidateProject(vars.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.plotPoints(vars.projectId) });
    },
  });
}

export function useDeletePlotPointMutation() {
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      ciciro.plotPoints.delete(id).then((result) => ({ ...result, projectId })),
    onSuccess: (_data, vars) => {
      invalidateProject(vars.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.plotPoints(vars.projectId) });
    },
  });
}

export function useCreateQuestionMutation() {
  return useMutation({
    mutationFn: (body: QuestionCreateRequest) => ciciro.questions.create(body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.questions.all(vars.projectId) });
    },
  });
}

export function usePatchQuestionMutation() {
  return useMutation({
    mutationFn: ({
      id,
      projectId,
      body,
    }: {
      id: string;
      projectId: string;
      body: Parameters<typeof ciciro.questions.patch>[1];
    }) => ciciro.questions.patch(id, body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.questions.all(vars.projectId) });
    },
  });
}

export function useDeleteQuestionMutation() {
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      ciciro.questions.delete(id).then((result) => ({ ...result, projectId })),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.questions.all(vars.projectId) });
    },
  });
}

export function useWriteBibleMutation() {
  return useMutation({
    mutationFn: (body: BibleWriteRequest) => ciciro.bible.write(body),
    onSuccess: (_data: BibleWriteResult, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bible.index(vars.projectId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.bible.file(vars.projectId, vars.path),
      });
    },
  });
}

function cacheCreatedBibleFile(data: BibleFile, projectId: string) {
  queryClient.setQueryData(queryKeys.bible.file(projectId, data.path), data);
  void queryClient.invalidateQueries({ queryKey: queryKeys.bible.index(projectId) });
}

export function useCreateBibleCharacterMutation() {
  return useMutation({
    mutationFn: (body: BibleNewCharacterRequest) => ciciro.bible.createCharacter(body),
    onSuccess: (data: BibleFile, vars) => {
      cacheCreatedBibleFile(data, vars.projectId);
    },
  });
}

export function useCreateBiblePlotMutation() {
  return useMutation({
    mutationFn: (body: BibleNewPlotRequest) => ciciro.bible.createPlot(body),
    onSuccess: (data: BibleFile, vars) => {
      cacheCreatedBibleFile(data, vars.projectId);
    },
  });
}

export function useClearChatMutation() {
  return useMutation({
    mutationFn: (projectId: string) => ciciro.chat.clear(projectId),
    onSuccess: (_data, projectId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.snapshot(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.insertions(projectId) });
    },
  });
}

export function useCompactChatMutation() {
  return useMutation({
    mutationFn: (projectId: string) => ciciro.chat.compact(projectId),
    onSuccess: (_data, projectId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.snapshot(projectId) });
    },
  });
}

export function useRecordDraftInsertionMutation() {
  return useMutation({
    mutationFn: (body: DraftInsertionCreateRequest) => ciciro.chat.insertions.record(body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chat.insertions(vars.projectId),
      });
    },
  });
}

export function useChapterOpsQuery(id: string, after = 0, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chapters.ops(id, after),
    queryFn: () => ciciro.chapters.ops.list(id, after),
    enabled: (options?.enabled ?? true) && Boolean(id),
  });
}

export function usePushChapterOpsMutation() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChapterOpsPushRequest }) =>
      ciciro.chapters.ops.push(id, body),
    onSuccess: (result) => {
      invalidateProject(result.chapter.projectId);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chapters.ops(result.chapter.id),
      });
    },
  });
}

export function useProjectPositionQuery(id: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.projects.position(id),
    queryFn: () => ciciro.projects.position.get(id),
    enabled: (options?.enabled ?? true) && Boolean(id),
  });
}

export function usePutReadingPositionMutation() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReadingPositionPutRequest }) =>
      ciciro.projects.position.put(id, body),
    onSuccess: (data, vars) => {
      queryClient.setQueryData(queryKeys.projects.position(vars.id), data);
    },
  });
}

export function useSyncPullQuery(projectId: string, after?: SyncAfter, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.sync.pull(projectId, after),
    queryFn: () => ciciro.sync.pull(projectId, after),
    enabled: (options?.enabled ?? true) && Boolean(projectId),
  });
}

export function useSyncPushMutation() {
  return useMutation({
    mutationFn: (body: SyncPushRequest) => ciciro.sync.push(body),
    onSuccess: (_data, vars) => {
      invalidateProject(vars.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sync.pull(vars.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.position(vars.projectId) });
    },
  });
}
