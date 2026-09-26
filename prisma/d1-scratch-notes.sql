-- Manuscript scratchpad (ScratchNote). Re-runnable.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-scratch-notes.sql
--
-- Until this runs, chapters and everything else work as before; only the
-- scratchpad itself errors.

CREATE TABLE IF NOT EXISTS "ScratchNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScratchNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ScratchNote_projectId_updatedAt_idx" ON "ScratchNote"("projectId", "updatedAt");
