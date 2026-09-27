# Agent instructions

## Merge conflicts

Resolve PR / branch conflicts by **rebasing** onto the base branch. Do not merge `main` (or `master`) into the feature branch to clear conflicts.

- `git fetch origin && git rebase origin/main` (or the PR's base branch)
- Never `git rebase -i` (no interactive rebase)
- After each conflict: edit, `git add`, `git rebase --continue`
- Already-pushed branch: `git push --force-with-lease`
- Never force-push `main` / `master`
- If a rebase is in progress, finish or abort it — do not start a merge

## Code the phone shares

The Expo app cannot import from the Next app, so `src/lib/manuscript.ts` and `src/lib/suggestions.ts` have byte-for-byte copies in `apps/mobile/lib/`. Change both; `test/manuscript-parity.test.ts` and `test/suggestions-parity.test.ts` fail when they drift. Pending tracked changes live inline in chapter HTML; see `docs/tracked-changes.md`.

## Production D1 schema

`prisma db push` never reaches the Worker's D1. A schema change needs a `prisma/d1-*.sql` upgrade (see `docs/hosting.md`) applied to production before merging to `main`; the `main` build fails while D1 is behind (`npm run db:check:d1`).

## Web motion

Durations and easings are tokens in `src/app/globals.css`, all scaled by `--motion`, which the reduce-motion setting and the OS preference set to 0; build on them, not on literal `ms`. JS waits on the exit times in `src/lib/motion.ts` (`test/motion.test.ts` fails when they drift from the tokens). A surface that animates out mounts through `Presence` or `usePresence`. Deleting something uses `useSnackbar` with `onCommit`, so the server hears about it only once Undo has lapsed.

## Mobile motion

Pass numbers into Reanimated worklets as arguments or same-scope locals: a default parameter or imported constant used inside one can be missing on the UI runtime. A throw there stops every animation until the app restarts, so if motion "does nothing" on the simulator, read Metro's log and relaunch before debugging the code.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
