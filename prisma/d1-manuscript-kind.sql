-- One-shot upgrade: manuscript kinds (novel, screenplay, blog, journal).
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so run this once; a second run fails
-- on the ALTER, which is harmless.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-manuscript-kind.sql
--
-- Run it before (or together with) deploying the build that adds manuscript kinds.
-- `kind` is a required column on Project and Prisma selects it on every project
-- query, so without it the shelf, opening a manuscript and the assistant all fail
-- with "no such column: kind". Existing manuscripts become novels.

ALTER TABLE "Project" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'novel';
