-- Chapter version history (ChapterSnapshot). Re-runnable.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-chapter-snapshots.sql
--
-- Until this runs, chapter writes still succeed: automatic snapshots are best
-- effort and never block the op log. Only the history panel itself errors.

CREATE TABLE IF NOT EXISTS "ChapterSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChapterSnapshot_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChapterSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ChapterSnapshot_chapterId_createdAt_idx" ON "ChapterSnapshot"("chapterId", "createdAt");
CREATE INDEX IF NOT EXISTS "ChapterSnapshot_projectId_idx" ON "ChapterSnapshot"("projectId");
