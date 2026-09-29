-- One-shot upgrade: User.emailVerifiedAt, set when Apple or Google vouches for
-- an email. A social sign-in that matches a password account whose email was
-- never verified takes it over (clears the password, revokes its sessions).
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so run this once; a second run fails
-- on the ALTER, which is harmless.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-email-verified.sql
--
-- Run it before (or together with) deploying the build that adds social
-- sign-in. Nullable, so "User" is not rebuilt and no Project or Session is
-- touched. Existing rows stay NULL: unverified.

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;
