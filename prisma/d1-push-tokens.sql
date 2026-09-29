-- Push notification tokens and their pending receipts (PushToken, PushTicket).
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-push-tokens.sql
--
-- Run it before deploying the build that ships push registration, not after:
-- account deletion and the data export read both tables, and sign-out clears
-- the session's tokens, so until it runs they fail with
-- `no such table: PushToken`.
--
-- Re-runnable: every statement is IF NOT EXISTS. New tables only, so "User"
-- and "Session" are not rebuilt and no row is touched.

CREATE TABLE IF NOT EXISTS "PushToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PushTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pushTokenId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushTicket_pushTokenId_fkey" FOREIGN KEY ("pushTokenId") REFERENCES "PushToken" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushToken_token_key" ON "PushToken"("token");
CREATE INDEX IF NOT EXISTS "PushToken_userId_idx" ON "PushToken"("userId");
CREATE INDEX IF NOT EXISTS "PushToken_sessionId_idx" ON "PushToken"("sessionId");
CREATE INDEX IF NOT EXISTS "PushTicket_pushTokenId_idx" ON "PushTicket"("pushTokenId");
CREATE INDEX IF NOT EXISTS "PushTicket_createdAt_idx" ON "PushTicket"("createdAt");
