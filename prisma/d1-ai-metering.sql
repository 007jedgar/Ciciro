-- Weighted AI metering: UsageCounter.autowriteWords, the monthly autowrite
-- word cap (independent of the aiRuns unit allowance). See docs/billing.md.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-ai-metering.sql
--
-- Additive only (a new column, default 0): every existing UsageCounter row
-- reads as having autowritten nothing yet. Re-runnable; SQLite has no
-- `ADD COLUMN IF NOT EXISTS`, so a second run fails on the ALTER, which is
-- harmless once it has already been applied.

ALTER TABLE "UsageCounter" ADD COLUMN "autowriteWords" INTEGER NOT NULL DEFAULT 0;
