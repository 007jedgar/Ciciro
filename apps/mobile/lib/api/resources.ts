import { api, apiBlob, readNdjsonPost } from "./client";
import { normalizeChatSnapshot } from "./types";
import type {
  AuthMeResponse,
  AuthSessionResponse,
  AutowriteRequest,
  AutowriteStreamEvent,
  BibleEntry,
  BibleFile,
  BibleNewCharacterRequest,
  BibleNewPlotRequest,
  BibleWriteRequest,
  BibleWriteResult,
  Chapter,
  ChapterCreateRequest,
  ChapterPatchRequest,
  ChapterSnapshotCreateRequest,
  ChapterSnapshotDetail,
  ChapterSnapshotListResponse,
  ChapterSnapshotRestoreResponse,
  ChapterSnapshotSummary,
  Character,
  CharacterCreateRequest,
  CharacterPatchRequest,
  ChatStreamEvent,
  CompactResult,
  DraftInsertion,
  DraftInsertionCreateRequest,
  EditorRunInput,
  ExportFile,
  ExportFormat,
  Folder,
  FolderCreateRequest,
  FolderPatchRequest,
  HealthStatus,
  ImportResult,
  LoginRequest,
  ManuscriptEdit,
  ManuscriptTargetPutRequest,
  ManuscriptTargetResponse,
  ScratchNote,
  ScratchNoteCreateRequest,
  ScratchNoteListResponse,
  ScratchNotePatchRequest,
  NdjsonEvent,
  OkResponse,
  OpenQuestion,
  ReminderNudgeResponse,
  PlotPoint,
  PlotPointCreateRequest,
  PlotPointPatchRequest,
  ProjectCreated,
  ProjectCreateRequest,
  ProjectDetail,
  ProjectListItem,
  ProjectPatchRequest,
  ProjectRecord,
  ReplaceRequest,
  ReplaceResult,
  SearchOptions,
  SearchResult,
  ChatClearResult,
  ChatRestoreResult,
  QuestionCreateRequest,
  QuestionPatchRequest,
  ReadingPositionPutRequest,
  ReadingPositionResponse,
  SettingsResponse,
  SignupRequest,
  WritingDayPutRequest,
  WritingDayResponse,
  WritingDaysResponse,
  WritingSessionPostRequest,
  WritingSessionResponse,
  WritingSessionsResponse,
  SyncAfter,
  SyncPushRequest,
  SyncResult,
  SyncStreamEvent,
  ChapterOpsListResponse,
  ChapterOpsPushRequest,
  ChapterOpsPushResponse,
  CorrectRequest,
  CorrectResponse,
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
  await readNdjsonPost(path, jsonInit("POST", body, opts), (event) => onEvent(event as T));
}

/**
 * A GET feed read by the same NDJSON machinery as the POST streams: React
 * Native has no EventSource, and XHR's growing responseText is the only
 * reliable way to see a long-lived body arrive chunk by chunk.
 */
async function streamFeed<T extends NdjsonEvent>(
  path: string,
  onEvent: (event: T) => void,
  opts?: RequestOpts
): Promise<void> {
  await readNdjsonPost(path, { ...opts, method: "GET" }, (event) => onEvent(event as T));
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

  writing: {
    day: {
      get: (date: string, opts?: RequestOpts) =>
        api<WritingDayResponse>(`/api/writing/day${queryString({ date })}`, opts),
      put: (body: WritingDayPutRequest, opts?: RequestOpts) =>
        api<WritingDayResponse>("/api/writing/day", jsonInit("PUT", body, opts)),
    },
    days: {
      get: (from: string, to: string, opts?: RequestOpts) =>
        api<WritingDaysResponse>(`/api/writing/days${queryString({ from, to })}`, opts),
    },
    sessions: {
      list: (limit = 50, opts?: RequestOpts) =>
        api<WritingSessionsResponse>(
          `/api/writing/sessions${queryString({ limit: String(limit) })}`,
          opts
        ),
      post: (body: WritingSessionPostRequest, opts?: RequestOpts) =>
        api<WritingSessionResponse>("/api/writing/sessions", jsonInit("POST", body, opts)),
    },
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
    target: {
      get: (id: string, opts?: RequestOpts) =>
        api<ManuscriptTargetResponse>(`/api/projects/${encodeURIComponent(id)}/target`, opts),
      put: (id: string, body: ManuscriptTargetPutRequest, opts?: RequestOpts) =>
        api<ManuscriptTargetResponse>(
          `/api/projects/${encodeURIComponent(id)}/target`,
          jsonInit("PUT", body, opts)
        ),
      delete: (id: string, opts?: RequestOpts) =>
        api<OkResponse>(
          `/api/projects/${encodeURIComponent(id)}/target`,
          jsonInit("DELETE", undefined, opts)
        ),
    },
    scratch: {
      list: (id: string, opts?: RequestOpts) =>
        api<ScratchNoteListResponse>(`/api/projects/${encodeURIComponent(id)}/scratch`, opts),
      create: (id: string, body: ScratchNoteCreateRequest, opts?: RequestOpts) =>
        api<ScratchNote>(
          `/api/projects/${encodeURIComponent(id)}/scratch`,
          jsonInit("POST", body, opts)
        ),
      update: (id: string, noteId: string, body: ScratchNotePatchRequest, opts?: RequestOpts) =>
        api<ScratchNote>(
          `/api/projects/${encodeURIComponent(id)}/scratch/${encodeURIComponent(noteId)}`,
          jsonInit("PATCH", body, opts)
        ),
      delete: (id: string, noteId: string, opts?: RequestOpts) =>
        api<OkResponse>(
          `/api/projects/${encodeURIComponent(id)}/scratch/${encodeURIComponent(noteId)}`,
          jsonInit("DELETE", undefined, opts)
        ),
    },
    reminderNudge: {
      post: (id: string, opts?: RequestOpts) =>
        api<ReminderNudgeResponse>(
          `/api/projects/${encodeURIComponent(id)}/reminder-nudge`,
          jsonInit("POST", {}, opts)
        ),
    },
  },

  search: {
    /** Every match of `query` across the manuscript's chapters. */
    find: (projectId: string, query: string, options: SearchOptions, opts?: RequestOpts) =>
      api<SearchResult>(
        `/api/projects/${encodeURIComponent(projectId)}/search${queryString({
          q: query,
          matchCase: options.matchCase ? "1" : null,
          wholeWord: options.wholeWord ? "1" : null,
        })}`,
        opts
      ),
    /** Replace one match (`target`) or every match. Written through the chapter op log. */
    replace: (projectId: string, body: ReplaceRequest, opts?: RequestOpts) =>
      api<ReplaceResult>(
        `/api/projects/${encodeURIComponent(projectId)}/replace`,
        jsonInit("POST", body, opts)
      ),
  },

  imports: {
    /** Multipart upload of a .docx, .md, .html or zipped .scriv file. */
    upload: (form: FormData, opts?: RequestOpts) =>
      api<ImportResult>("/api/import", { ...opts, method: "POST", body: form }),
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
    reorder: (body: { projectId: string; chapterIds: string[] }, opts?: RequestOpts) =>
      api<Chapter[]>("/api/chapters/reorder", jsonInit("POST", body, opts)),
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
    snapshots: {
      list: (id: string, opts?: RequestOpts) =>
        api<ChapterSnapshotListResponse>(`/api/chapters/${encodeURIComponent(id)}/snapshots`, opts),
      get: (id: string, snapshotId: string, opts?: RequestOpts) =>
        api<ChapterSnapshotDetail>(
          `/api/chapters/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}`,
          opts
        ),
      create: (id: string, body: ChapterSnapshotCreateRequest, opts?: RequestOpts) =>
        api<ChapterSnapshotSummary>(
          `/api/chapters/${encodeURIComponent(id)}/snapshots`,
          jsonInit("POST", body, opts)
        ),
      delete: (id: string, snapshotId: string, opts?: RequestOpts) =>
        api<OkResponse>(
          `/api/chapters/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}`,
          jsonInit("DELETE", undefined, opts)
        ),
      restore: (id: string, snapshotId: string, opts?: RequestOpts) =>
        api<ChapterSnapshotRestoreResponse>(
          `/api/chapters/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
          jsonInit("POST", undefined, opts)
        ),
    },
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
      api<BibleWriteResult>("/api/bible", jsonInit("POST", body, opts)),
    createCharacter: (body: BibleNewCharacterRequest, opts?: RequestOpts) =>
      api<BibleFile>("/api/bible", jsonInit("POST", body, opts)),
    createPlot: (body: BibleNewPlotRequest, opts?: RequestOpts) =>
      api<BibleFile>("/api/bible", jsonInit("POST", body, opts)),
  },

  chat: {
    get: async (projectId: string, opts?: RequestOpts) =>
      normalizeChatSnapshot(await api<unknown>(`/api/chat${queryString({ projectId })}`, opts)),
    /** Archives the conversation and hands back the stamp `restore` undoes by. */
    clear: (projectId: string, opts?: RequestOpts) =>
      api<ChatClearResult>(
        `/api/chat${queryString({ projectId })}`,
        jsonInit("DELETE", undefined, opts)
      ),
    restore: (projectId: string, archivedAt: string, opts?: RequestOpts) =>
      api<ChatRestoreResult>(
        "/api/chat/restore",
        jsonInit("POST", { projectId, archivedAt }, opts)
      ),
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
    download: (id: string, format?: ExportFormat, opts?: RequestOpts) =>
      apiBlob(
        `/api/export/${encodeURIComponent(id)}${queryString({ format })}`,
        opts
      ) as Promise<ExportFile>,
    downloadChapter: (id: string, chapterId: string, format?: ExportFormat, opts?: RequestOpts) =>
      apiBlob(
        `/api/export/${encodeURIComponent(id)}${queryString({ chapter: chapterId, format })}`,
        opts
      ) as Promise<ExportFile>,
  },

  correct: {
    post: (body: CorrectRequest, opts?: RequestOpts) =>
      api<CorrectResponse>("/api/correct", jsonInit("POST", body, opts)),
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
    /** Resolves when the server closes the poke channel; abort via opts.signal. */
    stream: (
      projectId: string,
      onEvent: (event: SyncStreamEvent) => void,
      opts?: RequestOpts
    ) => streamFeed(`/api/sync/stream${queryString({ projectId })}`, onEvent, opts),
  },
};
