-- One-shot upgrade for a D1 database whose "ChapterSnapshot" table was created
-- before it had "runId". Databases created from d1-chapter-snapshots.sql after
-- this change already have the column; that file is re-runnable, this one is
-- not (SQLite has no `ADD COLUMN IF NOT EXISTS`, so a second run fails).
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-snapshot-runs.sql
--
-- Until it runs, editor writes keep working, but their before_ai snapshots are
-- skipped (automatic snapshots are best effort).

ALTER TABLE "ChapterSnapshot" ADD COLUMN "runId" TEXT;
