-- One-shot upgrade: manuscript kinds (novel, screenplay, blog, journal).
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so run this once; a second run fails
-- on the ALTER, which is harmless.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-manuscript-kind.sql
--
-- Until this runs, every manuscript reads as a novel and creating one with another
-- kind errors; existing manuscripts are unaffected.

ALTER TABLE "Project" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'novel';
