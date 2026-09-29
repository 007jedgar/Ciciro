-- Shared password-attempt rate limiter (PasswordAttempt). Re-runnable.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-password-attempts.sql
--
-- Required before deploy: login and account deletion query this table on every
-- attempt, so until it runs both fail with a 500. Apply it to production D1
-- before merging to main.

CREATE TABLE IF NOT EXISTS "PasswordAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT,
    "ipHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PasswordAttempt_scope_key_createdAt_idx" ON "PasswordAttempt"("scope", "key", "createdAt");
CREATE INDEX IF NOT EXISTS "PasswordAttempt_ipHash_createdAt_idx" ON "PasswordAttempt"("ipHash", "createdAt");
CREATE INDEX IF NOT EXISTS "PasswordAttempt_createdAt_idx" ON "PasswordAttempt"("createdAt");
CREATE INDEX IF NOT EXISTS "PasswordAttempt_userId_idx" ON "PasswordAttempt"("userId");
