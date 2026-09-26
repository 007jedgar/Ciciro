-- Weekly reviews (WeeklyReview). Re-runnable.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-weekly-reviews.sql
--
-- Until this runs, chapters and everything else work as before; only the
-- weekly review itself errors.

CREATE TABLE IF NOT EXISTS "WeeklyReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "weekEnd" TEXT NOT NULL,
    "stats" TEXT NOT NULL DEFAULT '{}',
    "content" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WeeklyReview_projectId_createdAt_idx" ON "WeeklyReview"("projectId", "createdAt");
