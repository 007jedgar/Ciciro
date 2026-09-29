-- Email verification and password reset links (EmailToken).
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-email-tokens.sql
--
-- Run it before deploying the build that ships these flows, not after. The
-- flows also set User.emailVerifiedAt, which prisma/d1-email-verified.sql adds.
--
-- Re-runnable: every statement is IF NOT EXISTS. A new table, so "User" is
-- not rebuilt and no Project or Session is touched.

CREATE TABLE IF NOT EXISTS "EmailToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "EmailToken_userId_purpose_createdAt_idx" ON "EmailToken"("userId", "purpose", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailToken_expiresAt_idx" ON "EmailToken"("expiresAt");
