-- Beta reader share links and their comments (ShareLink, ShareComment). Re-runnable.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-share-links.sql
--
-- Until this runs, only sharing errors: the reader page and the share panels
-- report a missing table, and nothing else in the app reads these tables.

CREATE TABLE IF NOT EXISTS "ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "chapterIds" TEXT NOT NULL DEFAULT '[]',
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShareLink_token_key" ON "ShareLink"("token");
CREATE INDEX IF NOT EXISTS "ShareLink_projectId_createdAt_idx" ON "ShareLink"("projectId", "createdAt");

CREATE TABLE IF NOT EXISTS "ShareComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareLinkId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "readerName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "offset" INTEGER NOT NULL DEFAULT 0,
    "clientHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareComment_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareComment_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ShareComment_projectId_status_createdAt_idx" ON "ShareComment"("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ShareComment_shareLinkId_createdAt_idx" ON "ShareComment"("shareLinkId", "createdAt");
CREATE INDEX IF NOT EXISTS "ShareComment_shareLinkId_clientHash_createdAt_idx" ON "ShareComment"("shareLinkId", "clientHash", "createdAt");
CREATE INDEX IF NOT EXISTS "ShareComment_chapterId_idx" ON "ShareComment"("chapterId");
