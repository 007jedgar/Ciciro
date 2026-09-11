import { api, apiBlob, apiStream } from "./client";
import { readNdjson } from "./ndjson";
import type {
  AuthMeResponse,
  AuthSessionResponse,
  AutowriteRequest,
  AutowriteStreamEvent,
  BibleEntry,
  BibleFile,
  BibleNewCharacterRequest,
  BibleWriteRequest,
  Chapter,
  ChapterCreateRequest,
  ChapterPatchRequest,
  Character,
  CharacterCreateRequest,
  CharacterPatchRequest,
  ChatSnapshot,
  ChatStreamEvent,
  CompactResult,
  DraftInsertion,
  DraftInsertionCreateRequest,
  EditorRunInput,
  ExportFile,
  Folder,
  FolderCreateRequest,
  FolderPatchRequest,
  HealthStatus,
  LoginRequest,
  ManuscriptEdit,
  NdjsonEvent,
  OkResponse,
  OpenQuestion,
  PlotPoint,
  PlotPointCreateRequest,
  PlotPointPatchRequest,
  ProjectCreated,
  ProjectCreateRequest,
  ProjectDetail,
  ProjectListItem,
  ProjectPatchRequest,
  ProjectRecord,
  QuestionCreateRequest,
  QuestionPatchRequest,
  ReadingPositionPutRequest,
  ReadingPositionResponse,
  SettingsResponse,
  SignupRequest,
  SyncAfter,
  SyncPushRequest,
  SyncResult,
  ChapterOpsListResponse,
  ChapterOpsPushRequest,
  ChapterOpsPushResponse,
} from "./types";
import type { AppSettings, SettingsPatch } from "../app-settings";

type RequestOpts = Pick<RequestInit, "signal">;

function queryString(params: Record<string, string | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function jsonInit(method: string, body?: unknown, opts?: RequestOpts): RequestInit {
  return {
    ...opts,
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

async function streamEvents<T extends NdjsonEvent>(
  path: string,
  body: unknown,
  onEvent: (event: T) => void,
  opts?: RequestOpts
): Promise<void> {
  const stream = await apiStream(path, jsonInit("POST", body, opts));
  await readNdjson(stream, {
    signal: opts?.signal ?? undefined,
    onEvent: (event) => onEvent(event as T),
  });
}

export const ciciro = {
  health: {
    get: (opts?: RequestOpts) => api<HealthStatus>("/api/health", opts),
  },

  auth: {
    me: (opts?: RequestOpts) => api<AuthMeResponse>("/api/auth/me", opts),
    login: (body: LoginRequest, opts?: RequestOpts) =>
      api<AuthSessionResponse>("/api/auth/login", jsonInit("POST", body, opts)),
    signup: (body: SignupRequest, opts?: RequestOpts) =>
      api<AuthSessionResponse>("/api/auth/signup", jsonInit("POST", body, opts)),
    logout: (opts?: RequestOpts) =>
      api<OkResponse>("/api/auth/logout", jsonInit("POST", undefined, opts)),
  },

  settings: {
    get: (opts?: RequestOpts) => api<SettingsResponse>("/api/settings", opts),
    patch: (body: SettingsPatch, opts?: RequestOpts) =>
      api<SettingsResponse>("/api/settings", jsonInit("PATCH", body, opts)),
    put: (body: AppSettings, opts?: RequestOpts) =>
      api<SettingsResponse>("/api/settings", jsonInit("PUT", body, opts)),
  },

  projects: {
    list: (opts?: RequestOpts) => api<ProjectListItem[]>("/api/projects", opts),
    create: (body: ProjectCreateRequest, opts?: RequestOpts) =>
      api<ProjectCreated>("/api/projects", jsonInit("POST", body, opts)),
    get: (id: string, opts?: RequestOpts) =>
      api<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`, opts),
    patch: (id: string, body: ProjectPatchRequest, opts?: RequestOpts) =>
      api<ProjectRecord>(`/api/projects/${encodeURIComponent(id)}`, jsonInit("PATCH", body, opts)),
    delete: (id: string, opts?: RequestOpts) =>
      api<OkResponse>(`/api/projects/${encodeURIComponent(id)}`, jsonInit("DELETE", undefined, opts)),
    position: {
      get: (id: string, opts?: RequestOpts) =>
        api<ReadingPositionResponse>(
          `/api/projects/${encodeURIComponent(id)}/position`,
          opts
        ),
      put: (id: string, body: ReadingPositionPutRequest, opts?: RequestOpts) =>
        api<ReadingPositionResponse>(
          `/api/projects/${encodeURIComponent(id)}/position`,
          jsonInit("PUT", body, opts)
        ),
    },
  },

  folders: {
    list: (opts?: RequestOpts) => api<Folder[]>("/api/folders", opts),
    create: (body: FolderCreateRequest, opts?: RequestOpts) =>
      api<Folder>("/api/folders", jsonInit("POST", body, opts)),
    get: (id: string, opts?: RequestOpts) =>
      api<Folder>(`/api/folders/${encodeURIComponent(id)}`, opts),
    patch: (id: string, body: FolderPatchRequest, opts?: RequestOpts) =>
      api<Folder>(`/api/folders/${encodeURIComponent(id)}`, jsonInit("PATCH", body, opts)),
    delete: (id: string, opts?: RequestOpts) =>
      api<OkResponse>(`/api/folders/${encodeURIComponent(id)}`, jsonInit("DELETE", undefined, opts)),
    addProjects: (id: string, body: { projectIds: string[] }, opts?: RequestOpts) =>
      api<Folder>(
        `/api/folders/${encodeURIComponent(id)}/projects`,
        jsonInit("POST", body, opts)
      ),
    removeProjects: (id: string, body: { projectIds: string[] }, opts?: RequestOpts) =>
      api<Folder>(
        `/api/folders/${encodeURIComponent(id)}/projects`,
        jsonInit("DELETE", body, opts)
      ),
  },

  chapters: {
    list: (projectId: string, opts?: RequestOpts) =>
      api<Chapter[]>(`/api/chapters${queryString({ projectId })}`, opts),
    listArchived: (projectId: string, opts?: RequestOpts) =>
      api<Chapter[]>(`/api/chapters${queryString({ projectId, archived: "true" })}`, opts),
    create: (body: ChapterCreateRequest, opts?: RequestOpts) =>
      api<Chapter>("/api/chapters", jsonInit("POST", body, opts)),
    patch: (id: string, body: ChapterPatchRequest, opts?: RequestOpts) =>
      api<Chapter>(`/api/chapters/${encodeURIComponent(id)}`, jsonInit("PATCH", body, opts)),
    delete: (id: string, opts?: RequestOpts) =>
      api<OkResponse>(`/api/chapters/${encodeURIComponent(id)}`, jsonInit("DELETE", undefined, opts)),
    archive: (id: string, opts?: RequestOpts) =>
      api<Chapter>(
        `/api/chapters/${encodeURIComponent(id)}/archive`,
        jsonInit("POST", undefined, opts)
      ),
    unarchive: (id: string, opts?: RequestOpts) =>
      api<Chapter>(
        `/api/chapters/${encodeURIComponent(id)}/archive`,
        jsonInit("DELETE", undefined, opts)
      ),
    edits: (id: string, opts?: RequestOpts) =>
      api<ManuscriptEdit[]>(`/api/chapters/${encodeURIComponent(id)}/edits`, opts),
    ops: {
      list: (id: string, after?: number, opts?: RequestOpts) =>
        api<ChapterOpsListResponse>(
          `/api/chapters/${encodeURIComponent(id)}/ops${queryString({
            after: after == null ? undefined : String(after),
          })}`,
          opts
        ),
      push: (id: string, body: ChapterOpsPushRequest, opts?: RequestOpts) =>
        api<ChapterOpsPushResponse>(
          `/api/chapters/${encodeURIComponent(id)}/ops`,
          jsonInit("POST", body, opts)
        ),
    },
  },

  characters: {
    list: (projectId: string, opts?: RequestOpts) =>
      api<Character[]>(`/api/characters${queryString({ projectId })}`, opts),
    create: (body: CharacterCreateRequest, opts?: RequestOpts) =>
      api<Character>("/api/characters", jsonInit("POST", body, opts)),
    patch: (id: string, body: CharacterPatchRequest, opts?: RequestOpts) =>
      api<Character>(`/api/characters/${encodeURIComponent(id)}`, jsonInit("PATCH", body, opts)),
    delete: (id: string, opts?: RequestOpts) =>
      api<OkResponse>(`/api/characters/${encodeURIComponent(id)}`, jsonInit("DELETE", undefined, opts)),
  },

  plotPoints: {
    list: (projectId: string, opts?: RequestOpts) =>
      api<PlotPoint[]>(`/api/plotpoints${queryString({ projectId })}`, opts),
    create: (body: PlotPointCreateRequest, opts?: RequestOpts) =>
      api<PlotPoint>("/api/plotpoints", jsonInit("POST", body, opts)),
    patch: (id: string, body: PlotPointPatchRequest, opts?: RequestOpts) =>
      api<PlotPoint>(`/api/plotpoints/${encodeURIComponent(id)}`, jsonInit("PATCH", body, opts)),
    delete: (id: string, opts?: RequestOpts) =>
      api<OkResponse>(`/api/plotpoints/${encodeURIComponent(id)}`, jsonInit("DELETE", undefined, opts)),
  },

  questions: {
    list: (projectId: string, status?: string, opts?: RequestOpts) =>
      api<OpenQuestion[]>(`/api/questions${queryString({ projectId, status })}`, opts),
    create: (body: QuestionCreateRequest, opts?: RequestOpts) =>
      api<OpenQuestion>("/api/questions", jsonInit("POST", body, opts)),
    patch: (id: string, body: QuestionPatchRequest, opts?: RequestOpts) =>
      api<OpenQuestion>(`/api/questions/${encodeURIComponent(id)}`, jsonInit("PATCH", body, opts)),
    delete: (id: string, opts?: RequestOpts) =>
      api<OkResponse>(`/api/questions/${encodeURIComponent(id)}`, jsonInit("DELETE", undefined, opts)),
  },

  bible: {
    list: (projectId: string, opts?: RequestOpts) =>
      api<BibleEntry[]>(`/api/bible${queryString({ projectId })}`, opts),
    read: (projectId: string, path: string, opts?: RequestOpts) =>
      api<BibleFile>(`/api/bible${queryString({ projectId, path })}`, opts),
    write: (body: BibleWriteRequest, opts?: RequestOpts) =>
      api<OkResponse>("/api/bible", jsonInit("POST", body, opts)),
    createCharacter: (body: BibleNewCharacterRequest, opts?: RequestOpts) =>
      api<BibleFile>("/api/bible", jsonInit("POST", body, opts)),
  },

  chat: {
    get: (projectId: string, opts?: RequestOpts) =>
      api<ChatSnapshot>(`/api/chat${queryString({ projectId })}`, opts),
    clear: (projectId: string, opts?: RequestOpts) =>
      api<OkResponse>(`/api/chat${queryString({ projectId })}`, jsonInit("DELETE", undefined, opts)),
    compact: (projectId: string, opts?: RequestOpts) =>
      api<CompactResult>(
        "/api/chat",
        jsonInit("POST", { projectId, compactOnly: true }, opts)
      ),
    start: (
      body: EditorRunInput,
      onEvent: (event: ChatStreamEvent) => void,
      opts?: RequestOpts
    ) => streamEvents("/api/chat", body, onEvent, opts),
    insertions: {
      list: (projectId: string, opts?: RequestOpts) =>
        api<DraftInsertion[]>(`/api/chat/insertions${queryString({ projectId })}`, opts),
      record: (body: DraftInsertionCreateRequest, opts?: RequestOpts) =>
        api<DraftInsertion>("/api/chat/insertions", jsonInit("POST", body, opts)),
    },
  },

  autowrite: {
    start: (
      body: AutowriteRequest,
      onEvent: (event: AutowriteStreamEvent) => void,
      opts?: RequestOpts
    ) => streamEvents("/api/autowrite", body, onEvent, opts),
  },

  export: {
    download: (id: string, opts?: RequestOpts) =>
      apiBlob(`/api/export/${encodeURIComponent(id)}`, opts) as Promise<ExportFile>,
  },

  sync: {
    pull: (projectId: string, after?: SyncAfter, opts?: RequestOpts) =>
      api<SyncResult>(
        `/api/sync${queryString({
          projectId,
          after: after ? JSON.stringify(after) : undefined,
        })}`,
        opts
      ),
    push: (body: SyncPushRequest, opts?: RequestOpts) =>
      api<SyncResult>("/api/sync", jsonInit("POST", body, opts)),
  },
};
