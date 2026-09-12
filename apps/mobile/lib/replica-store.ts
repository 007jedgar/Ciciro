import type {
  ChapterSnapshot,
  PendingBibleWrite,
  PendingChapterOp,
  PendingReadingPosition,
  ReplicaBibleFile,
  ReplicaChapterOp,
  ReplicaReadingPosition,
} from "./db";
import type { ManuscriptOp } from "./manuscript";

export type { ChapterSnapshot, PendingBibleWrite, PendingChapterOp, PendingReadingPosition };

export type ReplicaStore = {
  getChapter(id: string): Promise<ChapterSnapshot | null>;
  listChapters(projectId: string): Promise<ChapterSnapshot[]>;
  upsertChapter(chapter: ChapterSnapshot): Promise<void>;
  insertOp(op: ReplicaChapterOp): Promise<void>;
  getBible(projectId: string, path: string): Promise<ReplicaBibleFile | null>;
  listBible(projectId: string): Promise<ReplicaBibleFile[]>;
  upsertBible(file: ReplicaBibleFile): Promise<void>;
  getPosition(userId: string, projectId: string): Promise<ReplicaReadingPosition | null>;
  upsertPosition(position: ReplicaReadingPosition): Promise<void>;
  enqueueOp(op: PendingChapterOp): Promise<void>;
  listPendingOps(projectId: string): Promise<PendingChapterOp[]>;
  deletePendingOps(opIds: string[]): Promise<void>;
  upsertPendingBible(write: PendingBibleWrite): Promise<void>;
  listPendingBible(projectId: string): Promise<PendingBibleWrite[]>;
  deletePendingBible(projectId: string, path: string): Promise<void>;
  getPendingPosition(userId: string, projectId: string): Promise<PendingReadingPosition | null>;
  upsertPendingPosition(position: PendingReadingPosition): Promise<void>;
  deletePendingPosition(userId: string, projectId: string): Promise<void>;
};

export function payloadOf(op: ManuscriptOp): string {
  return JSON.stringify(op);
}

export function opFromPayload(payload: string): ManuscriptOp {
  return JSON.parse(payload) as ManuscriptOp;
}
