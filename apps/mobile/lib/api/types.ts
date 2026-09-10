import type { AppSettings, SettingsPatch } from "../app-settings";

export type { AppSettings, SettingsPatch };

export type PublicUser = {
  id: string;
  email: string;
  name: string;
};

export type OkResponse = { ok: true };

export type ProjectRecord = {
  id: string;
  userId: string | null;
  folderId: string | null;
  title: string;
  author: string;
  genre: string;
  logline: string;
  synopsis: string;
  theme: string;
  pov: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectListItem = ProjectRecord & {
  _count: { chapters: number };
};

export type Chapter = {
  id: string;
  projectId: string;
  title: string;
  order: number;
  content: string;
  summary: string;
  status: string;
  wordCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type Character = {
  id: string;
  projectId: string;
  name: string;
  role: string;
  description: string;
  arc: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type PlotPoint = {
  id: string;
  projectId: string;
  chapterId: string | null;
  title: string;
  description: string;
  type: string;
  status: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = ProjectRecord & {
  chapters: Chapter[];
  characters?: Character[];
  plotPoints?: PlotPoint[];
};

export type ProjectCreated = ProjectRecord & {
  chapters: Chapter[];
};

export type Folder = {
  id: string;
  userId: string | null;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  projects: ProjectListItem[];
  _count: { projects: number };
};

export type OpenQuestion = {
  id: string;
  projectId: string;
  question: string;
  provisional: string;
  affects: string;
  chapterId: string | null;
  status: string;
  answer: string;
  resolution: string;
  createdAt: string;
  updatedAt: string;
};

export type ManuscriptEdit = {
  id: string;
  chapterId: string;
  find: string;
  replace: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelContent?: string | null;
  kind: string;
  turnId?: string | null;
  status?: string;
  archivedAt?: string | null;
  createdAt: string;
};

export type EditorRunStatus =
  | "queued"
  | "running"
  | "continuing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type EditorRun = {
  id: string;
  projectId: string;
  turnId: string;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  kind?: string;
  scope?: "selection" | "chapter" | "book" | null;
  activeChapterId?: string | null;
  selection?: string;
  autoMode?: boolean;
  status: EditorRunStatus;
  visibleOutput: string;
  iterationCount: number;
  mutationCount: number;
  stopReason?: string | null;
  verificationJson?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatSnapshot = {
  messages: ChatMessage[];
  runs: EditorRun[];
};

export type DraftInsertion = {
  id: string;
  projectId: string;
  turnId: string;
  segmentIndex: number;
  chapterId: string;
  createdAt: string;
};

export type HealthStatus = {
  status: "ok" | "degraded";
  db: "ok" | "down";
  authRequired: boolean;
  latencyMs: number;
  time: string;
};

export type AuthMeResponse = {
  user: PublicUser | null;
  settings: AppSettings | null;
};

export type AuthSessionResponse = {
  user: PublicUser;
  settings: AppSettings;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type SignupRequest = {
  email: string;
  password: string;
  name?: string;
};

export type SettingsResponse = {
  settings: AppSettings;
};

export type ProjectCreateRequest = {
  title?: string;
  author?: string;
  genre?: string;
  logline?: string;
  folderId?: string | null;
};

export type ProjectPatchRequest = {
  title?: string;
  author?: string;
  genre?: string;
  logline?: string;
  synopsis?: string;
  theme?: string;
  pov?: string;
  notes?: string;
  folderId?: string | null;
};

export type FolderCreateRequest = {
  name: string;
  notes?: string;
  projectIds?: string[];
};

export type FolderPatchRequest = {
  name?: string;
  notes?: string;
};

export type FolderProjectsRequest = {
  projectIds: string[];
};

export type ChapterCreateRequest = {
  projectId: string;
  title?: string;
};

export type ChapterPatchRequest = {
  expectedRevision: number;
  content?: string;
  title?: string;
  summary?: string;
  status?: string;
  order?: number;
};

export type ChapterConflictBody = {
  error: string;
  expectedRevision: number;
  currentRevision: number;
  chapter: Chapter;
};

export type CharacterCreateRequest = {
  projectId: string;
  name: string;
  role?: string;
  description?: string;
  arc?: string;
  notes?: string;
};

export type CharacterPatchRequest = {
  name?: string;
  role?: string;
  description?: string;
  arc?: string;
  notes?: string;
};

export type PlotPointCreateRequest = {
  projectId: string;
  title: string;
  description?: string;
  type?: string;
  status?: string;
  chapterId?: string | null;
};

export type PlotPointPatchRequest = {
  title?: string;
  description?: string;
  type?: string;
  status?: string;
  chapterId?: string | null;
};

export type QuestionCreateRequest = {
  projectId: string;
  question: string;
  provisional?: string;
  affects?: string;
  chapterId?: string | null;
};

export type QuestionPatchRequest = {
  question?: string;
  provisional?: string;
  affects?: string;
  answer?: string;
  resolution?: string;
  status?: string;
  chapterId?: string | null;
};

export type BibleEntry = {
  path: string;
  summary: string;
};

export type BibleFile = {
  path: string;
  content: string;
};

export type BibleWriteRequest = {
  projectId: string;
  path: string;
  content: string;
};

export type BibleNewCharacterRequest = {
  projectId: string;
  newCharacter: string;
};

export type EditorScope = "selection" | "chapter" | "book";

export type EditorRunInput = {
  projectId: string;
  message?: string;
  activeChapterId?: string | null;
  selection?: string;
  kind?: string;
  scope?: EditorScope;
  autoMode?: boolean;
  resumeTurnId?: string;
  continueFrom?: string;
  forceCompact?: boolean;
  clientTurnId?: string;
};

export type CompactResult =
  | { compacted: false }
  | { compacted: true; removed: number; summaryId: string; statusLine: string };

export type EditorRunBusyBody = {
  error: string;
  turnId: string;
  runId: string;
  status: string;
};

export type DraftInsertionCreateRequest = {
  projectId: string;
  turnId: string;
  segmentIndex: number;
  chapterId: string;
};

export type AutowriteRequest = {
  projectId: string;
  chapterId: string;
  targetWords?: number;
  guidance?: string;
};

export type ClientUiEvent =
  | { type: "open_chapter"; chapterId: string; number: number; title: string }
  | { type: "chapter_created"; chapter: Chapter; open: boolean }
  | {
      type: "chapter_updated";
      chapterId: string;
      content: string;
      wordCount: number;
      revision: number;
      title?: string;
    };

export type ChatStreamEvent =
  | { type: "ping" }
  | { type: "turn"; id: string; runId: string }
  | { type: "text"; v: string; resume?: boolean }
  | { type: "tool"; v: string }
  | {
      type: "phase";
      status: EditorRunStatus;
      runId: string;
      stopReason?: string | null;
      iterationCount?: number;
      mutationCount?: number;
    }
  | {
      type: "done";
      status: EditorRunStatus;
      runId: string;
      stopReason?: string | null;
      iterationCount?: number;
      mutationCount?: number;
    }
  | { type: "ui"; event: ClientUiEvent }
  | ({ type: string } & Record<string, unknown>);

export type AutowriteStreamEvent =
  | { type: "ping" }
  | { type: "phase"; v: string }
  | {
      type: "beat";
      i: number;
      n: number;
      status: "drafting" | "editing" | "accepted" | string;
      goal: string;
      words?: number;
    }
  | { type: "prose"; v: string }
  | { type: "note"; v: string }
  | { type: "error"; v: string }
  | { type: "stopped" }
  | {
      type: "done";
      beats: number;
      words: number;
      content: string;
      revision: number;
      wordCount: number;
    }
  | ({ type: string } & Record<string, unknown>);

export type NdjsonEvent = ChatStreamEvent | AutowriteStreamEvent;

export type ExportFile = {
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
};
