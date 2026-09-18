import { Platform } from "react-native";
import { open, type DB, type Scalar } from "@op-engineering/op-sqlite";

const REPLICA_NAME = "ciciro.sqlite";

let replica: DB | null = null;

/** Local manuscript replica. Tokens stay in SecureStore; this is the op log + snapshots. */
export function getReplica(): DB {
  if (Platform.OS === "web") {
    throw new Error("The manuscript replica is native-only.");
  }
  if (!replica) {
    replica = open({ name: REPLICA_NAME });
  }
  return replica;
}

export type ChapterSnapshot = {
  id: string;
  projectId: string;
  title: string;
  order: number;
  content: string;
  summary: string;
  status: string;
  wordCount: number;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReplicaChapterOp = {
  id: string;
  chapterId: string;
  projectId: string;
  opId: string;
  seq: number;
  baseRevision: number;
  actor: string;
  type: string;
  payload: string;
  createdAt: string;
};

export type ReplicaBibleFile = {
  id: string;
  projectId: string;
  path: string;
  content: string;
  revision: number;
  updatedAt: string;
  createdAt: string;
};

export type ReplicaReadingPosition = {
  id: string;
  userId: string;
  projectId: string;
  chapterId: string;
  blockId: string;
  offset: number;
  updatedAt: string;
};

export type PendingChapterOp = {
  opId: string;
  chapterId: string;
  projectId: string;
  payload: string;
  createdAt: string;
};

export type PendingBibleWrite = {
  projectId: string;
  path: string;
  content: string;
  revision: number;
  createdAt: string;
};

export type PendingReadingPosition = {
  userId: string;
  projectId: string;
  chapterId: string;
  blockId: string;
  offset: number;
  updatedAt: string;
};

export type ReplicaWritingDay = {
  userId: string;
  date: string;
  words: number;
  activeMs: number;
  pendingWords: number;
  pendingActiveMs: number;
  lastKeystrokeAt: number | null;
  updatedAt: string;
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS Chapter (
    id TEXT PRIMARY KEY NOT NULL,
    projectId TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled Chapter',
    "order" INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    wordCount INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    archivedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ChapterOp (
    id TEXT PRIMARY KEY NOT NULL,
    chapterId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    opId TEXT NOT NULL,
    seq INTEGER NOT NULL,
    baseRevision INTEGER NOT NULL,
    actor TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    UNIQUE (chapterId, opId)
  )`,
  `CREATE INDEX IF NOT EXISTS ChapterOp_chapterId_seq ON ChapterOp (chapterId, seq)`,
  `CREATE INDEX IF NOT EXISTS ChapterOp_projectId_createdAt ON ChapterOp (projectId, createdAt)`,
  `CREATE TABLE IF NOT EXISTS BibleFile (
    id TEXT PRIMARY KEY NOT NULL,
    projectId TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    UNIQUE (projectId, path)
  )`,
  `CREATE INDEX IF NOT EXISTS BibleFile_projectId ON BibleFile (projectId)`,
  `CREATE TABLE IF NOT EXISTS ReadingPosition (
    id TEXT PRIMARY KEY NOT NULL,
    userId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    chapterId TEXT NOT NULL,
    blockId TEXT NOT NULL,
    offset INTEGER NOT NULL,
    updatedAt TEXT NOT NULL,
    UNIQUE (userId, projectId)
  )`,
  `CREATE INDEX IF NOT EXISTS ReadingPosition_projectId ON ReadingPosition (projectId)`,
  `CREATE TABLE IF NOT EXISTS PendingOp (
    opId TEXT PRIMARY KEY NOT NULL,
    chapterId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    payload TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS PendingOp_projectId ON PendingOp (projectId, createdAt)`,
  `CREATE TABLE IF NOT EXISTS PendingBible (
    projectId TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    revision INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (projectId, path)
  )`,
  `CREATE TABLE IF NOT EXISTS PendingPosition (
    userId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    chapterId TEXT NOT NULL,
    blockId TEXT NOT NULL,
    offset INTEGER NOT NULL,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (userId, projectId)
  )`,
  `CREATE TABLE IF NOT EXISTS WritingDay (
    userId TEXT NOT NULL,
    date TEXT NOT NULL,
    words INTEGER NOT NULL DEFAULT 0,
    activeMs INTEGER NOT NULL DEFAULT 0,
    pendingWords INTEGER NOT NULL DEFAULT 0,
    pendingActiveMs INTEGER NOT NULL DEFAULT 0,
    lastKeystrokeAt INTEGER,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (userId, date)
  )`,
];

export async function ensureReplica(): Promise<DB> {
  const db = getReplica();
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA foreign_keys = ON");
  for (const sql of SCHEMA) {
    await db.execute(sql);
  }
  return db;
}

type RowObject = Record<string, unknown>;

async function query<T>(db: DB, sql: string, params: Scalar[] = []): Promise<T[]> {
  const result = await db.execute(sql, params);
  return ((result.rows ?? []) as RowObject[]) as T[];
}

export async function upsertChapterSnapshot(chapter: ChapterSnapshot): Promise<void> {
  const db = await ensureReplica();
  await db.execute(
    `INSERT INTO Chapter (
      id, projectId, title, "order", content, summary, status,
      wordCount, revision, archivedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      projectId = excluded.projectId,
      title = excluded.title,
      "order" = excluded."order",
      content = excluded.content,
      summary = excluded.summary,
      status = excluded.status,
      wordCount = excluded.wordCount,
      revision = excluded.revision,
      archivedAt = excluded.archivedAt,
      updatedAt = excluded.updatedAt`,
    [
      chapter.id,
      chapter.projectId,
      chapter.title,
      chapter.order,
      chapter.content,
      chapter.summary,
      chapter.status,
      chapter.wordCount,
      chapter.revision,
      chapter.archivedAt,
      chapter.createdAt,
      chapter.updatedAt,
    ]
  );
}

export async function getChapterSnapshot(id: string): Promise<ChapterSnapshot | null> {
  const db = await ensureReplica();
  const rows = await query<ChapterSnapshot>(
    db,
    `SELECT id, projectId, title, "order" AS "order", content, summary, status,
            wordCount, revision, archivedAt, createdAt, updatedAt
     FROM Chapter WHERE id = ?`,
    [id]
  );
  return rows[0] ?? null;
}

export async function insertChapterOp(op: ReplicaChapterOp): Promise<void> {
  const db = await ensureReplica();
  await db.execute(
    `INSERT OR IGNORE INTO ChapterOp (
      id, chapterId, projectId, opId, seq, baseRevision, actor, type, payload, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      op.id,
      op.chapterId,
      op.projectId,
      op.opId,
      op.seq,
      op.baseRevision,
      op.actor,
      op.type,
      op.payload,
      op.createdAt,
    ]
  );
}

export async function listChapterOpsAfter(
  chapterId: string,
  afterSeq = 0
): Promise<ReplicaChapterOp[]> {
  const db = await ensureReplica();
  return query<ReplicaChapterOp>(
    db,
    `SELECT id, chapterId, projectId, opId, seq, baseRevision, actor, type, payload, createdAt
     FROM ChapterOp WHERE chapterId = ? AND seq > ? ORDER BY seq ASC`,
    [chapterId, afterSeq]
  );
}

export async function upsertBibleFile(file: ReplicaBibleFile): Promise<void> {
  const db = await ensureReplica();
  await db.execute(
    `INSERT INTO BibleFile (id, projectId, path, content, revision, updatedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(projectId, path) DO UPDATE SET
       content = excluded.content,
       revision = excluded.revision,
       updatedAt = excluded.updatedAt`,
    [file.id, file.projectId, file.path, file.content, file.revision, file.updatedAt, file.createdAt]
  );
}

export async function getBibleFile(
  projectId: string,
  path: string
): Promise<ReplicaBibleFile | null> {
  const db = await ensureReplica();
  const rows = await query<ReplicaBibleFile>(
    db,
    `SELECT id, projectId, path, content, revision, updatedAt, createdAt
     FROM BibleFile WHERE projectId = ? AND path = ?`,
    [projectId, path]
  );
  return rows[0] ?? null;
}

export async function upsertReadingPosition(position: ReplicaReadingPosition): Promise<void> {
  const db = await ensureReplica();
  await db.execute(
    `INSERT INTO ReadingPosition (id, userId, projectId, chapterId, blockId, offset, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId, projectId) DO UPDATE SET
       chapterId = excluded.chapterId,
       blockId = excluded.blockId,
       offset = excluded.offset,
       updatedAt = excluded.updatedAt`,
    [
      position.id,
      position.userId,
      position.projectId,
      position.chapterId,
      position.blockId,
      position.offset,
      position.updatedAt,
    ]
  );
}

export async function getReadingPosition(
  userId: string,
  projectId: string
): Promise<ReplicaReadingPosition | null> {
  const db = await ensureReplica();
  const rows = await query<ReplicaReadingPosition>(
    db,
    `SELECT id, userId, projectId, chapterId, blockId, offset, updatedAt
     FROM ReadingPosition WHERE userId = ? AND projectId = ?`,
    [userId, projectId]
  );
  return rows[0] ?? null;
}

export async function listChapterSnapshots(projectId: string): Promise<ChapterSnapshot[]> {
  const db = await ensureReplica();
  return query<ChapterSnapshot>(
    db,
    `SELECT id, projectId, title, "order" AS "order", content, summary, status,
            wordCount, revision, archivedAt, createdAt, updatedAt
     FROM Chapter WHERE projectId = ? ORDER BY "order" ASC`,
    [projectId]
  );
}

export async function listBibleFiles(projectId: string): Promise<ReplicaBibleFile[]> {
  const db = await ensureReplica();
  return query<ReplicaBibleFile>(
    db,
    `SELECT id, projectId, path, content, revision, updatedAt, createdAt
     FROM BibleFile WHERE projectId = ? ORDER BY path ASC`,
    [projectId]
  );
}

export async function enqueuePendingOp(op: PendingChapterOp): Promise<void> {
  const db = await ensureReplica();
  await db.execute(
    `INSERT OR REPLACE INTO PendingOp (opId, chapterId, projectId, payload, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [op.opId, op.chapterId, op.projectId, op.payload, op.createdAt]
  );
}

export async function listPendingOps(projectId: string): Promise<PendingChapterOp[]> {
  const db = await ensureReplica();
  return query<PendingChapterOp>(
    db,
    `SELECT opId, chapterId, projectId, payload, createdAt
     FROM PendingOp WHERE projectId = ? ORDER BY createdAt ASC, opId ASC`,
    [projectId]
  );
}

export async function deletePendingOps(opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;
  const db = await ensureReplica();
  const placeholders = opIds.map(() => "?").join(", ");
  await db.execute(`DELETE FROM PendingOp WHERE opId IN (${placeholders})`, opIds);
}

export async function upsertPendingBible(write: PendingBibleWrite): Promise<void> {
  const db = await ensureReplica();
  await db.execute(
    `INSERT INTO PendingBible (projectId, path, content, revision, createdAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(projectId, path) DO UPDATE SET
       content = excluded.content,
       revision = excluded.revision,
       createdAt = excluded.createdAt`,
    [write.projectId, write.path, write.content, write.revision, write.createdAt]
  );
}

export async function listPendingBible(projectId: string): Promise<PendingBibleWrite[]> {
  const db = await ensureReplica();
  return query<PendingBibleWrite>(
    db,
    `SELECT projectId, path, content, revision, createdAt
     FROM PendingBible WHERE projectId = ? ORDER BY createdAt ASC`,
    [projectId]
  );
}

export async function deletePendingBible(projectId: string, path: string): Promise<void> {
  const db = await ensureReplica();
  await db.execute(`DELETE FROM PendingBible WHERE projectId = ? AND path = ?`, [projectId, path]);
}

export async function upsertPendingPosition(position: PendingReadingPosition): Promise<void> {
  const db = await ensureReplica();
  await db.execute(
    `INSERT INTO PendingPosition (userId, projectId, chapterId, blockId, offset, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId, projectId) DO UPDATE SET
       chapterId = excluded.chapterId,
       blockId = excluded.blockId,
       offset = excluded.offset,
       updatedAt = excluded.updatedAt`,
    [
      position.userId,
      position.projectId,
      position.chapterId,
      position.blockId,
      position.offset,
      position.updatedAt,
    ]
  );
}

export async function getPendingPosition(
  userId: string,
  projectId: string
): Promise<PendingReadingPosition | null> {
  const db = await ensureReplica();
  const rows = await query<PendingReadingPosition>(
    db,
    `SELECT userId, projectId, chapterId, blockId, offset, updatedAt
     FROM PendingPosition WHERE userId = ? AND projectId = ?`,
    [userId, projectId]
  );
  return rows[0] ?? null;
}

export async function deletePendingPosition(userId: string, projectId: string): Promise<void> {
  const db = await ensureReplica();
  await db.execute(`DELETE FROM PendingPosition WHERE userId = ? AND projectId = ?`, [
    userId,
    projectId,
  ]);
}

function writingDayFromRow(row: ReplicaWritingDay): ReplicaWritingDay {
  return {
    userId: row.userId,
    date: row.date,
    words: Number(row.words) || 0,
    activeMs: Number(row.activeMs) || 0,
    pendingWords: Number(row.pendingWords) || 0,
    pendingActiveMs: Number(row.pendingActiveMs) || 0,
    lastKeystrokeAt:
      row.lastKeystrokeAt == null ? null : Number.isFinite(Number(row.lastKeystrokeAt)) ? Number(row.lastKeystrokeAt) : null,
    updatedAt: row.updatedAt,
  };
}

export async function getWritingDay(
  userId: string,
  date: string
): Promise<ReplicaWritingDay | null> {
  const db = await ensureReplica();
  const rows = await query<ReplicaWritingDay>(
    db,
    `SELECT userId, date, words, activeMs, pendingWords, pendingActiveMs, lastKeystrokeAt, updatedAt
     FROM WritingDay WHERE userId = ? AND date = ?`,
    [userId, date]
  );
  return rows[0] ? writingDayFromRow(rows[0]) : null;
}

export async function upsertWritingDay(row: ReplicaWritingDay): Promise<void> {
  const db = await ensureReplica();
  await db.execute(
    `INSERT INTO WritingDay (
      userId, date, words, activeMs, pendingWords, pendingActiveMs, lastKeystrokeAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId, date) DO UPDATE SET
      words = excluded.words,
      activeMs = excluded.activeMs,
      pendingWords = excluded.pendingWords,
      pendingActiveMs = excluded.pendingActiveMs,
      lastKeystrokeAt = excluded.lastKeystrokeAt,
      updatedAt = excluded.updatedAt`,
    [
      row.userId,
      row.date,
      row.words,
      row.activeMs,
      row.pendingWords,
      row.pendingActiveMs,
      row.lastKeystrokeAt,
      row.updatedAt,
    ]
  );
}
