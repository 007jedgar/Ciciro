import type {
  ChapterSnapshot,
  PendingBibleWrite,
  PendingChapterOp,
  PendingReadingPosition,
  ReplicaBibleFile,
  ReplicaChapterOp,
  ReplicaReadingPosition,
} from "./db";
import type { ReplicaStore } from "./replica-store";

/** In-memory replica used by tests and anywhere SQLite is unavailable. */
export function createMemoryReplica(): ReplicaStore {
  const chapters = new Map<string, ChapterSnapshot>();
  const ops = new Map<string, ReplicaChapterOp>();
  const bible = new Map<string, ReplicaBibleFile>();
  const positions = new Map<string, ReplicaReadingPosition>();
  const pendingOps = new Map<string, PendingChapterOp>();
  const pendingBible = new Map<string, PendingBibleWrite>();
  const pendingPosition = new Map<string, PendingReadingPosition>();

  const bibleKey = (projectId: string, path: string) => `${projectId}:${path}`;
  const positionKey = (userId: string, projectId: string) => `${userId}:${projectId}`;

  return {
    async getChapter(id) {
      return chapters.get(id) ?? null;
    },
    async listChapters(projectId) {
      return [...chapters.values()]
        .filter((c) => c.projectId === projectId)
        .sort((a, b) => a.order - b.order);
    },
    async upsertChapter(chapter) {
      chapters.set(chapter.id, { ...chapter });
    },
    async insertOp(op) {
      const key = `${op.chapterId}:${op.opId}`;
      if (!ops.has(key)) ops.set(key, { ...op });
    },
    async getBible(projectId, path) {
      return bible.get(bibleKey(projectId, path)) ?? null;
    },
    async listBible(projectId) {
      return [...bible.values()]
        .filter((f) => f.projectId === projectId)
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    async upsertBible(file) {
      bible.set(bibleKey(file.projectId, file.path), { ...file });
    },
    async getPosition(userId, projectId) {
      return positions.get(positionKey(userId, projectId)) ?? null;
    },
    async upsertPosition(position) {
      positions.set(positionKey(position.userId, position.projectId), { ...position });
    },
    async enqueueOp(op) {
      pendingOps.set(op.opId, { ...op });
    },
    async listPendingOps(projectId) {
      return [...pendingOps.values()]
        .filter((op) => op.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async deletePendingOps(opIds) {
      for (const id of opIds) pendingOps.delete(id);
    },
    async upsertPendingBible(write) {
      pendingBible.set(bibleKey(write.projectId, write.path), { ...write });
    },
    async listPendingBible(projectId) {
      return [...pendingBible.values()]
        .filter((w) => w.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async deletePendingBible(projectId, path) {
      pendingBible.delete(bibleKey(projectId, path));
    },
    async getPendingPosition(userId, projectId) {
      return pendingPosition.get(positionKey(userId, projectId)) ?? null;
    },
    async upsertPendingPosition(position) {
      pendingPosition.set(positionKey(position.userId, position.projectId), { ...position });
    },
    async deletePendingPosition(userId, projectId) {
      pendingPosition.delete(positionKey(userId, projectId));
    },
  };
}
