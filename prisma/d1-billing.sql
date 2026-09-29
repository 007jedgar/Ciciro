-- Billing: Subscription, BillingEvent, UsageCounter, and User.stripeCustomerId.
-- See docs/billing.md.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-billing.sql
--
-- Run it before deploying the build that ships billing: every User query
-- selects stripeCustomerId, so until the column exists sign-in fails with
-- `no such column: stripeCustomerId`. Only additive: the column is nullable
-- and its uniqueness is a separate index, so "User" is not rebuilt (a rebuild
-- would cascade-delete every Project and Session on D1).
--
-- The tables are re-runnable. SQLite has no `ADD COLUMN IF NOT EXISTS`, so a
-- second run fails on the ALTER at the end, which is harmless: everything
-- before it has already been applied.

CREATE TABLE IF NOT EXISTS "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "productId" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "interval" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "currentPeriodEnd" DATETIME,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_externalId_key" ON "Subscription"("externalId");
CREATE INDEX IF NOT EXISTS "Subscription_userId_idx" ON "Subscription"("userId");

CREATE TABLE IF NOT EXISTS "BillingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingEvent_source_eventId_key" ON "BillingEvent"("source", "eventId");
CREATE INDEX IF NOT EXISTS "BillingEvent_userId_idx" ON "BillingEvent"("userId");

CREATE TABLE IF NOT EXISTS "UsageCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "aiRuns" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UsageCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UsageCounter_userId_period_key" ON "UsageCounter"("userId", "period");

ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
