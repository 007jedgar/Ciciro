-- One-shot upgrade: per-chapter AI-involvement tally (see src/lib/text.ts
-- `aiInvolvement`). SQLite has no `ADD COLUMN IF NOT EXISTS`, so run
-- this once; a second run fails on the ALTERs, which is harmless.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-ai-involvement.sql
--
-- Run it before (or together with) deploying the build that adds the
-- disclosure summary. `aiAcceptedWords`, `aiDraftedWords` and `wordsAdded`
-- are read on every chapter query, so without them the app fails with
-- "no such column: aiAcceptedWords".
--
-- SQLite refuses `ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP` ("Cannot add a
-- column with non-constant default"), so `aiInvolvementSince` is added with a
-- constant placeholder and then set to this migration's run time for every
-- existing chapter. That is the correct start: their history predates
-- tracking, so counting starts now, not backdated to their creation. New
-- chapters get their own creation time from Prisma's @default(now()).

ALTER TABLE "Chapter" ADD COLUMN "aiAcceptedWords" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Chapter" ADD COLUMN "aiDraftedWords" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Chapter" ADD COLUMN "wordsAdded" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Chapter" ADD COLUMN "aiInvolvementSince" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE "Chapter" SET "aiInvolvementSince" = CURRENT_TIMESTAMP;
