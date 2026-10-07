-- One-shot upgrade: the who-knows-what ledger learns story order (see
-- src/lib/knowledge-ledger.ts). Adds where a retired fact stopped being true
-- and a free-text topic for the per-fact grid, and moves the first
-- vocabulary's "believes" rows to "suspects", the closest of the four stances
-- (knows, suspects, believes_wrong, unaware). Add-only: nothing is rebuilt.
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so run this once; a second run
-- fails on the first ALTER, which is harmless.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-knowledge-as-of.sql
--
-- Apply before merging the build that ships it. Every KnowledgeFact query
-- reads both columns, so until they exist the Knowledge screen, the chat's
-- knowledge tools, the continuity check, What changed, account deletion and
-- the data export fail with "no such column: supersededAtChapterId".

ALTER TABLE "KnowledgeFact" ADD COLUMN "supersededAtChapterId" TEXT REFERENCES "Chapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeFact" ADD COLUMN "topic" TEXT;

CREATE INDEX IF NOT EXISTS "KnowledgeFact_supersededAtChapterId_idx" ON "KnowledgeFact"("supersededAtChapterId");

UPDATE "KnowledgeFact" SET "stance" = 'suspects' WHERE "stance" = 'believes';
