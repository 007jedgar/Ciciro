-- One-shot upgrade: per-chapter AI-involvement tally (see src/lib/text.ts,
-- docs/tracked-changes.md). SQLite has no `ADD COLUMN IF NOT EXISTS`, so run
-- this once; a second run fails on the ALTERs, which is harmless.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-ai-involvement.sql
--
-- Run it before (or together with) deploying the build that adds the
-- disclosure summary. `aiAcceptedWords` and `aiDraftedWords` are read on every
-- chapter query, so without them the app fails with
-- "no such column: aiAcceptedWords". `aiInvolvementSince` defaults to this
-- migration's run time for every existing chapter, which is correct: their
-- history predates tracking, so counting starts now, not at CURRENT_TIMESTAMP
-- backdated to their creation.

ALTER TABLE "Chapter" ADD COLUMN "aiAcceptedWords" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Chapter" ADD COLUMN "aiDraftedWords" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Chapter" ADD COLUMN "aiInvolvementSince" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
