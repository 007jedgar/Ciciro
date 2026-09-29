-- Sign in with Apple and Google (Identity, AuthHandoff). Re-runnable.
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-social-sign-in.sql
--
-- Until this runs, email + password keeps working and only the Apple and
-- Google buttons fail. User.passwordHash stays NOT NULL on purpose: accounts
-- without a password store "" (see NO_PASSWORD in src/lib/auth/identity.ts).
-- Relaxing it would mean rebuilding "User", and D1 cannot turn foreign keys
-- off, so the DROP TABLE would cascade-delete every Project and Session.

CREATE TABLE IF NOT EXISTS "Identity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "refreshToken" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Identity_userId_idx" ON "Identity"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Identity_provider_subject_key" ON "Identity"("provider", "subject");

CREATE TABLE IF NOT EXISTS "AuthHandoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthHandoff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthHandoff_codeHash_key" ON "AuthHandoff"("codeHash");
CREATE INDEX IF NOT EXISTS "AuthHandoff_expiresAt_idx" ON "AuthHandoff"("expiresAt");
