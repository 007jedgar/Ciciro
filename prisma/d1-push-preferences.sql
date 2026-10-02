-- Push notification preferences and the send log (PushPreference, PushNotificationLog).
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-push-preferences.sql
--
-- Run it before deploying the build that ships server-sent push triggers
-- (share comments, the writing nudge, chat-finished), not after: those paths
-- read PushPreference and write PushNotificationLog, so until it runs they
-- fail with `no such table: PushPreference` / `PushNotificationLog`.
--
-- Re-runnable: every statement is IF NOT EXISTS. New tables only, so "User"
-- is not rebuilt and no row is touched.

CREATE TABLE IF NOT EXISTS "PushPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "shareComments" BOOLEAN NOT NULL DEFAULT true,
    "writingNudge" BOOLEAN NOT NULL DEFAULT true,
    "chatFinished" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PushPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PushNotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushNotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushPreference_userId_key" ON "PushPreference"("userId");
CREATE INDEX IF NOT EXISTS "PushPreference_userId_idx" ON "PushPreference"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "PushNotificationLog_userId_key_key" ON "PushNotificationLog"("userId", "key");
CREATE INDEX IF NOT EXISTS "PushNotificationLog_userId_category_createdAt_idx" ON "PushNotificationLog"("userId", "category", "createdAt");
