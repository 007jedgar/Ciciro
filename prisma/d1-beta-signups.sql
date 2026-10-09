-- iOS TestFlight beta signups from the landing page (BetaSignup). Re-runnable.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-beta-signups.sql
--
-- Required before deploy: the landing page's signup form writes to this table,
-- so until it runs the form answers 503. Apply it to production D1
-- before merging to main. New table only; no row is touched.

CREATE TABLE IF NOT EXISTS "BetaSignup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'landing',
    "ipHash" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "BetaSignup_email_key" ON "BetaSignup"("email");
CREATE INDEX IF NOT EXISTS "BetaSignup_ipHash_createdAt_idx" ON "BetaSignup"("ipHash", "createdAt");
