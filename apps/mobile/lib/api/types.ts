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
  archivedAt?: string | null;
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

/** How a chapter snapshot was taken. Mirrors src/lib/snapshot-view.ts. */
export type ChapterSnapshotKind = "manual" | "before_ai" | "session" | "before_restore";

/** One version in a chapter's history, without its prose. */
export type ChapterSnapshotSummary = {
  id: string;
  chapterId: string;
  kind: ChapterSnapshotKind;
  label: string;
  wordCount: number;
  revision: number;
  createdAt: string;
};

export type ChapterSnapshotDetail = ChapterSnapshotSummary & { content: string };

export type ChapterSnapshotListResponse = { snapshots: ChapterSnapshotSummary[] };

export type ChapterSnapshotCreateRequest = { label?: string };

export type ChapterSnapshotRestoreResponse = {
  chapter: Chapter;
  restored: ChapterSnapshotSummary;
  /** The text the restore replaced; restoring it undoes the restore. */
  backup: ChapterSnapshotSummary | null;
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

export function normalizeChatSnapshot(value: unknown): ChatSnapshot {
  if (Array.isArray(value)) {
    return { messages: value as ChatMessage[], runs: [] };
  }
  if (!value || typeof value !== "object") return { messages: [], runs: [] };
  const snapshot = value as { messages?: unknown; runs?: unknown };
  return {
    messages: Array.isArray(snapshot.messages) ? (snapshot.messages as ChatMessage[]) : [],
    runs: Array.isArray(snapshot.runs) ? (snapshot.runs as EditorRun[]) : [],
  };
}

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
  token?: string;
};

export type AuthSessionResponse = {
  user: PublicUser;
  settings: AppSettings;
  token?: string;
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

export type ChapterNotEmptyBody = {
  error: string;
  chapterId: string;
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

export type ChatClearResult = {
  ok: true;
  /**
   * The stamp this clear was archived under, and the handle Undo restores by.
   * Null when there was nothing on screen to clear.
   */
  archivedAt: string | null;
  count: number;
};

export type ChatRestoreResult = { ok: true; count: number };

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
  revision?: number;
};

export type BibleWriteRequest = {
  projectId: string;
  path: string;
  content: string;
  expectedRevision?: number;
};

export type BibleWriteResult = {
  ok: true;
  path: string;
  revision: number;
};

// The wire shape of an op is the editor's shape. Re-exported rather than
// restated so a third copy cannot drift from the two that already have to
// agree byte-for-byte (src/lib/manuscript.ts and ../manuscript.ts).
import type { ManuscriptActor, ManuscriptOp } from "../manuscript";

export type { ManuscriptActor, ManuscriptOp };

export type ChapterOpRecord = ManuscriptOp & {
  chapterId: string;
  projectId: string;
  seq: number;
  createdAt: string;
};

export type ChapterOpsPushRequest = {
  ops: ManuscriptOp[];
};

export type ChapterOpsPushResponse = {
  accepted: Array<{ op: ManuscriptOp; seq: number }>;
  rejected: Array<{ op: ManuscriptOp; reason: "stale" | "missing_block"; chapter: Chapter }>;
  chapter: Chapter;
  ops: ChapterOpRecord[];
};

export type ChapterOpsListResponse = {
  chapter: Chapter;
  ops: ChapterOpRecord[];
};

export type ReadingPosition = {
  projectId: string;
  chapterId: string;
  blockId: string;
  offset: number;
  updatedAt: string;
};

export type ReadingPositionPutRequest = {
  chapterId: string;
  blockId: string;
  offset: number;
};

export type ReadingPositionResponse = {
  position: ReadingPosition | null;
};

export type WritingDay = {
  date: string;
  words: number;
  activeMs: number;
  updatedAt?: string;
};

export type WritingDayPutRequest = {
  date: string;
  words: number;
  activeMs: number;
};

export type WritingDayResponse = {
  day: WritingDay;
};

export type WritingDaysResponse = {
  from: string | null;
  to: string | null;
  days: WritingDay[];
};

export type WritingSession = {
  id?: string;
  projectId: string | null;
  startedAt: number;
  endedAt: number;
  words: number;
  activeMs: number;
};

export type WritingSessionPostRequest = {
  projectId?: string | null;
  startedAt: number;
  endedAt: number;
  words: number;
  activeMs: number;
};

export type WritingSessionsResponse = {
  sessions: WritingSession[];
};

export type WritingSessionResponse = {
  session: WritingSession;
};

export type ManuscriptTargetPace = {
  remaining: number;
  daysLeft: number;
  pace: number | null;
  pastDeadline: boolean;
  complete: boolean;
};

export type ManuscriptTarget = {
  projectId: string;
  wordGoal: number;
  deadline: string;
  manuscriptWords: number;
  pace: ManuscriptTargetPace;
};

export type ManuscriptTargetPutRequest = {
  wordGoal: number;
  deadline: string;
};

export type ManuscriptTargetResponse = {
  target: ManuscriptTarget | null;
};

export type ReminderNudgeResponse = {
  body: string | null;
};

export type SyncAfter = {
  chapters?: Record<string, number>;
  bible?: Record<string, number>;
  /**
   * Fingerprint of the confirmed document per chapter, at the revision named
   * in `chapters`. Sent only for chapters with nothing pending locally: a
   * chapter holding unpushed ops has a locally-advanced revision that names no
   * server seq, so there would be nothing to compare against.
   */
  hashes?: Record<string, string>;
};

/** A chapter the server and this replica disagree about at the same revision. */
export type ChapterDivergence = {
  chapterId: string;
  revision: number;
  clientHash: string;
  serverHash: string;
  chapter: Chapter;
};

export type SyncOp = ManuscriptOp & { chapterId: string };

export type SyncPushRequest = {
  projectId: string;
  after?: SyncAfter;
  ops?: SyncOp[];
  bible?: { path: string; revision: number; content: string }[];
  position?: ReadingPositionPutRequest;
};

export type SyncResult = {
  accepted: Array<{ op: ManuscriptOp; seq: number }>;
  rejected: Array<{ op: ManuscriptOp; reason: "stale" | "missing_block"; chapter: Chapter }>;
  bibleRejected: Array<{ path: string; expectedRevision: number; currentRevision: number }>;
  chapters: Array<{ id: string; revision: number; wordCount: number }>;
  bible: Array<{ path: string; revision: number }>;
  position: ReadingPosition | null;
  ops: ChapterOpRecord[];
  bibleFiles: Array<{ path: string; content: string; revision: number }>;
  diverged?: ChapterDivergence[];
};

export type ChapterHeadFrame = {
  type: "heads";
  chapters: Array<{ id: string; revision: number }>;
};

/** Frames on GET /api/sync/stream: a poke when a head moves, else a keepalive. */
export type SyncStreamEvent =
  | { type: "ping" }
  | ChapterHeadFrame
  | ({ type: string } & Record<string, unknown>);

export type BibleNewCharacterRequest = {
  projectId: string;
  newCharacter: string;
};

export type BibleNewPlotRequest = {
  projectId: string;
  newPlot: string;
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
    }
  | {
      // A fork the editor resolved provisionally rather than stopping to ask.
      type: "question_raised";
      question: Pick<
        OpenQuestion,
        "id" | "question" | "provisional" | "affects" | "chapterId"
      >;
    }
  | { type: "question_resolved"; questionId: string; resolution: string };

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

export type NdjsonEvent = ChatStreamEvent | AutowriteStreamEvent | SyncStreamEvent;

export type ExportFormat = "epub" | "pdf" | "docx";

export type ExportFile = {
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
};

export type CorrectionSpan = {
  start: number;
  end: number;
  replacement: string;
};

export type CorrectRequest = {
  chapterId: string;
  blockId: string;
  text: string;
  revision: number;
};

export type CorrectResponse = CorrectRequest & {
  spans: CorrectionSpan[];
};

export type ImportResult = {
  projectId: string;
  title: string;
  appended: boolean;
  chapters: { id: string; title: string; order: number; wordCount: number }[];
};

export type SearchOptions = { matchCase: boolean; wholeWord: boolean };

export type SearchMatch = {
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number;
  blockId: string;
  occurrence: number;
  offset: number;
  length: number;
  before: string;
  match: string;
  after: string;
};

export type SearchResult = {
  matches: SearchMatch[];
  total: number;
  truncated: boolean;
  chapters: number;
};

export type ReplaceRequest = SearchOptions & {
  query: string;
  replacement: string;
  target?: { chapterId: string; blockId: string; occurrence: number; offset: number };
};

export type ReplaceResult = {
  replaced: number;
  chapters: { id: string; content: string; revision: number; wordCount: number; replaced: number }[];
};
