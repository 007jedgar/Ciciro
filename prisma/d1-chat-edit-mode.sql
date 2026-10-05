-- One-shot upgrade: per-turn Allow edits / Chat only switch for the editor chat
-- (see src/lib/edit-mode.ts). SQLite has no `ADD COLUMN IF NOT EXISTS`, so run
-- this once; a second run fails on the ALTER, which is harmless.
--
-- Apply with: wrangler d1 execute ciciro --remote --file=prisma/d1-chat-edit-mode.sql
--
-- Run it before (or together with) deploying the build that adds the switch.
-- `editsAllowed` is read on every EditorRun query, so without it the app fails
-- with "no such column: editsAllowed". Existing runs allow edits, as they did.

ALTER TABLE "EditorRun" ADD COLUMN "editsAllowed" BOOLEAN NOT NULL DEFAULT true;
