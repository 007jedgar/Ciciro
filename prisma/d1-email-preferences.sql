-- Marketing-email consent (EmailPreference) and send log (MarketingEmailLog).
-- See docs/hosting.md#email.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-email-preferences.sql
--
-- Run it before deploying the build that ships marketing email: the signup
-- opt-in checkbox, the Settings preferences UI, and every marketing send read
-- or write EmailPreference. Only additive: two new tables, so "User" is not
-- rebuilt and no Project or Session is touched.
--
-- Re-runnable: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "EmailPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptInAt" DATETIME,
    "productUpdates" BOOLEAN NOT NULL DEFAULT true,
    "weeklyEmail" BOOLEAN NOT NULL DEFAULT true,
    "offers" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribeToken" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailPreference_userId_key" ON "EmailPreference"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailPreference_unsubscribeToken_key" ON "EmailPreference"("unsubscribeToken");
CREATE INDEX IF NOT EXISTS "EmailPreference_userId_idx" ON "EmailPreference"("userId");

CREATE TABLE IF NOT EXISTS "MarketingEmailLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingEmailLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingEmailLog_userId_key_key" ON "MarketingEmailLog"("userId", "key");
CREATE INDEX IF NOT EXISTS "MarketingEmailLog_userId_idx" ON "MarketingEmailLog"("userId");
CREATE INDEX IF NOT EXISTS "MarketingEmailLog_key_idx" ON "MarketingEmailLog"("key");
