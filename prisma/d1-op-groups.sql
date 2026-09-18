-- One-shot upgrade for a D1 database created before grouped, seq-claimed ops.
-- Databases created from d1-sync-tables.sql after this change already have all
-- of it; that file is re-runnable, this one is not (SQLite has no
-- `ADD COLUMN IF NOT EXISTS`, so a second run fails on the two ALTERs).
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-op-groups.sql
--
-- The unique index is the important half: it turns `seq` into the atomic claim
-- that lets appendOps write the op row and the chapter snapshot as one batch.
-- If it fails with a constraint error the log already holds two ops at the same
-- seq for one chapter, which must be reconciled by hand first. Find them with:
--   SELECT chapterId, seq, COUNT(*) c FROM ChapterOp
--   GROUP BY chapterId, seq HAVING c > 1;

ALTER TABLE "ChapterOp" ADD COLUMN "groupId" TEXT;
ALTER TABLE "ChapterOp" ADD COLUMN "v" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS "ChapterOp_chapterId_seq_key" ON "ChapterOp"("chapterId", "seq");
CREATE INDEX IF NOT EXISTS "ChapterOp_chapterId_groupId_idx" ON "ChapterOp"("chapterId", "groupId");
