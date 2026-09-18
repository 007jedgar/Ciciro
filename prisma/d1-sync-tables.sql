-- Tables the hosted Worker expects for /api/sync and /api/writing/day.
-- Production D1 was created before these models existed; Prisma db push
-- against DATABASE_URL does not update the Worker D1 binding.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-sync-tables.sql

CREATE TABLE IF NOT EXISTS "ChapterOp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "groupId" TEXT,
    "v" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChapterOp_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChapterOp_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ChapterOp_chapterId_seq_idx" ON "ChapterOp"("chapterId", "seq");
CREATE INDEX IF NOT EXISTS "ChapterOp_projectId_createdAt_idx" ON "ChapterOp"("projectId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterOp_chapterId_opId_key" ON "ChapterOp"("chapterId", "opId");
-- Claiming a seq is the atomic right to write that revision. See appendOps.
CREATE UNIQUE INDEX IF NOT EXISTS "ChapterOp_chapterId_seq_key" ON "ChapterOp"("chapterId", "seq");
CREATE INDEX IF NOT EXISTS "ChapterOp_chapterId_groupId_idx" ON "ChapterOp"("chapterId", "groupId");

CREATE TABLE IF NOT EXISTS "BibleFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BibleFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BibleFile_projectId_idx" ON "BibleFile"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "BibleFile_projectId_path_key" ON "BibleFile"("projectId", "path");

CREATE TABLE IF NOT EXISTS "ReadingPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "offset" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReadingPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReadingPosition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReadingPosition_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ReadingPosition_projectId_idx" ON "ReadingPosition"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "ReadingPosition_userId_projectId_key" ON "ReadingPosition"("userId", "projectId");

CREATE TABLE IF NOT EXISTS "WritingDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "words" INTEGER NOT NULL DEFAULT 0,
    "activeMs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WritingDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WritingDay_userId_idx" ON "WritingDay"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "WritingDay_userId_date_key" ON "WritingDay"("userId", "date");
