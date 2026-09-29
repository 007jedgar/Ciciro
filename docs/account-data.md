# Account deletion and data export

Both live in `src/lib/account/` and cover every Prisma model. A test fails when
a new model is missing from either, so adding a model means deciding how it is
deleted and exported:

- `PURGED_MODELS` / `purgeAccountData` in `delete.ts`
  (`test/account-delete.integration.test.ts`, which also runs the purge with
  foreign keys off, so it never leans on cascades production D1 might lack)
- `EXPORT_TABLES` in `export.ts` (`test/account-export.integration.test.ts`)

## Deletion

`DELETE /api/auth/account` (`src/app/api/auth/account/route.ts`) needs a
session plus fresh proof: the password, or for an account without one the
typed word `DELETE` (`verifyDeletionProof`). Then `deleteAccount`:

1. runs `PRE_DELETE_HOOKS` in order. A hook that throws aborts everything, with
   the account intact, and the author sees a 502 to retry. This is where
   outside services plug in:
   - billing: cancel the Stripe subscription (RevenueCat purchases are
     cancelled by the author in the store),
   - Sign in with Apple: revoke the Apple token
     (`https://appleid.apple.com/auth/revoke`), which App Store review
     requires. When social sign-in lands, also accept a fresh provider sign-in
     as proof in `verifyDeletionProof`, and give the delete dialog/screen the
     typed-confirmation path for accounts without a password.
2. deletes every owned row in one `$transaction([...])` batch (D1 has no
   interactive transactions), children first, sessions included.

There is no R2/KV/blob storage keyed by user; Durable Objects hold only run
leases and poke sockets. The phone empties its replica, reminders and last
place afterwards (`apps/mobile/lib/account-data.ts`).

The web dialog is `src/components/DeleteAccountDialog.tsx` (settings popover
and the public `/account/delete` page, which the app stores link to); the
phone's is `apps/mobile/app/delete-account.tsx`.

## Export

`GET /api/account/export` streams a zip built with fflate (`zip-stream.ts`):
`data/<table>.json` per model plus `manuscripts/<title>/` with Markdown, Word,
the story bible and the scratchpad. Each table is read by id cursor a page at a
time and compressed straight into the response, so memory follows one page, not
the account (sized for a Worker's 128 MB). The Word builder is the exception: it
holds a whole manuscript, so manuscripts over `DOCX_WORD_BUDGET` words ship as
Markdown only.

`manifest.json` is the last entry: `completed: true` plus a record count per
data file. The response is already a 200 by the time a query can fail, so a
mid-stream error leaves a truncated zip; one that won't open, or lacks
`manifest.json`, means retry the export. The phone checks the zip's end record
before sharing and reports a truncated download instead.

Left out on purpose: password hash, session token hashes, the Apple refresh token,
the codes and challenges of pending app sign-ins, share link tokens,
the rate-limit hash of beta readers' IPs, and editor-run lock tokens.
