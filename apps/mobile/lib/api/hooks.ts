import { useMutation, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "./keys";
import { queryClient } from "./query";
import { ciciro } from "./resources";
import type {
  BibleFile,
  BibleNewCharacterRequest,
  BibleWriteRequest,
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
} from "./types";
import type { AppSettings, SettingsPatch } from "../app-settings";

type Enabled = { enabled?: boolean };

function invalidateProject(projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
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

export function useProjectQuery(id: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => ciciro.projects.get(id),
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
  });
}

export function useChaptersQuery(projectId: string, options?: Enabled) {
  return useQuery({
    queryKey: queryKeys.chapters.list(projectId),
    queryFn: () => ciciro.chapters.list(projectId),
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
    queryKey: queryKeys.questions(projectId, status),
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
    onSuccess: (folder: Folder) => {
      queryClient.setQueryData(queryKeys.folders.detail(folder.id), folder);
      invalidateFolders();
    },
  });
}

export function useDeleteFolderMutation() {
  return useMutation({
    mutationFn: (id: string) => ciciro.folders.delete(id),
    onSuccess: () => {
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
    onSuccess: () => {
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
    onSuccess: () => {
      invalidateFolders();
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

export function useCreateChapterMutation() {
  return useMutation({
    mutationFn: (body: ChapterCreateRequest) => ciciro.chapters.create(body),
    onSuccess: (chapter, vars) => {
      queryClient.setQueryData(
        queryKeys.projects.detail(vars.projectId),
        (current: ProjectDetail | undefined) =>
          current ? { ...current, chapters: [...current.chapters, chapter] } : current
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(vars.projectId) });
    },
  });
}

export function usePatchChapterMutation() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof ciciro.chapters.patch>[1] }) =>
      ciciro.chapters.patch(id, body),
    onSuccess: (chapter: Chapter) => {
      invalidateProject(chapter.projectId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(chapter.projectId) });
    },
  });
}

export function useDeleteChapterMutation() {
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      ciciro.chapters.delete(id).then((result) => ({ ...result, projectId })),
    onSuccess: (_data, vars) => invalidateProject(vars.projectId),
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.questions(vars.projectId) });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.questions(vars.projectId) });
    },
  });
}

export function useDeleteQuestionMutation() {
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
      ciciro.questions.delete(id).then((result) => ({ ...result, projectId })),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.questions(vars.projectId) });
    },
  });
}

export function useWriteBibleMutation() {
  return useMutation({
    mutationFn: (body: BibleWriteRequest) => ciciro.bible.write(body),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bible.index(vars.projectId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.bible.file(vars.projectId, vars.path),
      });
    },
  });
}

export function useCreateBibleCharacterMutation() {
  return useMutation({
    mutationFn: (body: BibleNewCharacterRequest) => ciciro.bible.createCharacter(body),
    onSuccess: (_data: BibleFile, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bible.index(vars.projectId) });
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
