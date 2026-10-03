-- Who-knows-what ledger, chapter-close dismissals, and the planning canvas.
-- Re-runnable. New tables only.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-knowledge-and-canvas.sql
--
-- Account deletion and the data export read every one of these tables, so
-- apply this before merging the build that ships them. Until it runs, those
-- two fail with "no such table", and the chapter-close and canvas features
-- error. Chapters and the rest of the app keep working.

CREATE TABLE IF NOT EXISTS "KnowledgeFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "characterPath" TEXT NOT NULL,
    "fact" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "chapterId" TEXT,
    "sourceQuote" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeFact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeFact_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "KnowledgeFact_projectId_characterPath_status_idx" ON "KnowledgeFact"("projectId", "characterPath", "status");
CREATE INDEX IF NOT EXISTS "KnowledgeFact_chapterId_idx" ON "KnowledgeFact"("chapterId");

CREATE TABLE IF NOT EXISTS "StateProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StateProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StateProposal_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "StateProposal_projectId_fingerprint_key" ON "StateProposal"("projectId", "fingerprint");
CREATE INDEX IF NOT EXISTS "StateProposal_projectId_chapterId_idx" ON "StateProposal"("projectId", "chapterId");

CREATE TABLE IF NOT EXISTS "CanvasLabel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanvasLabel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CanvasLabel_projectId_name_key" ON "CanvasLabel"("projectId", "name");
CREATE INDEX IF NOT EXISTS "CanvasLabel_projectId_idx" ON "CanvasLabel"("projectId");

CREATE TABLE IF NOT EXISTS "CanvasCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CanvasCard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CanvasCard_projectId_idx" ON "CanvasCard"("projectId");

CREATE TABLE IF NOT EXISTS "CanvasCardLabel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    CONSTRAINT "CanvasCardLabel_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CanvasCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CanvasCardLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "CanvasLabel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CanvasCardLabel_cardId_labelId_key" ON "CanvasCardLabel"("cardId", "labelId");
CREATE INDEX IF NOT EXISTS "CanvasCardLabel_labelId_idx" ON "CanvasCardLabel"("labelId");

CREATE TABLE IF NOT EXISTS "CanvasEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanvasEdge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CanvasEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "CanvasCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CanvasEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "CanvasCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CanvasEdge_fromId_toId_key" ON "CanvasEdge"("fromId", "toId");
CREATE INDEX IF NOT EXISTS "CanvasEdge_projectId_idx" ON "CanvasEdge"("projectId");
CREATE INDEX IF NOT EXISTS "CanvasEdge_toId_idx" ON "CanvasEdge"("toId");
