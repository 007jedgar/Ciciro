-- One-shot upgrade: a screenplay's own settings (title page, the (MORE) and
-- (CONT'D) switches, scene numbers) as one JSON string on the manuscript.
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so run this once; a second run fails
-- on the ALTER, which is harmless.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-script-settings.sql
--
-- Run it before (or together with) deploying the build that ships the title
-- page. `scriptSettings` is a required column on Project and Prisma selects it
-- on every project query, so without it the shelf, opening a manuscript and the
-- assistant all fail with "no such column: scriptSettings". Existing manuscripts
-- start with the empty string, which reads as every setting at its default.

ALTER TABLE "Project" ADD COLUMN "scriptSettings" TEXT NOT NULL DEFAULT '';
