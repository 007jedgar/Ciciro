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

The Expo app cannot import from the Next app, so `src/lib/manuscript.ts` and `src/lib/suggestions.ts` have byte-for-byte copies in `apps/mobile/lib/`. Change both; `test/manuscript-parity.test.ts` and `test/suggestions-parity.test.ts` fail when they drift. Pending tracked changes live inline in chapter HTML; see `docs/tracked-changes.md`. Not every pure `src/lib` module needs a mobile mirror - only add one, plus a parity test, when mobile actually gains a surface that uses it (e.g. `src/lib/repetition.ts` is web-only today; there is no mobile Repetition screen).

## Patched native editor

`apps/mobile` patches `react-native-enriched-html` (`paragraphSpacing`) through `patch-package` in `apps/mobile/patches/`. After editing `node_modules` for a fix, regenerate with `npx patch-package react-native-enriched-html`; any native change needs a rebuilt dev client.

## Production D1 schema

`prisma db push` never reaches the Worker's D1. A schema change needs a `prisma/d1-*.sql` upgrade (see `docs/hosting.md`) applied to production before merging to `main`; the `main` build fails while D1 is behind (`npm run db:check:d1`).

## Web motion

Durations and easings are tokens in `src/app/globals.css`, all scaled by `--motion`, which the reduce-motion setting and the OS preference set to 0; build on them, not on literal `ms`. JS waits on the exit times in `src/lib/motion.ts` (`test/motion.test.ts` fails when they drift from the tokens). A surface that animates out mounts through `Presence` or `usePresence`. Deleting something uses `useSnackbar` with `onCommit`, so the server hears about it only once Undo has lapsed.

## Mobile motion

Pass numbers into Reanimated worklets as arguments or same-scope locals: a default parameter or imported constant used inside one can be missing on the UI runtime. A throw there stops every animation until the app restarts, so if motion "does nothing" on the simulator, read Metro's log and relaunch before debugging the code.

## AI-involvement tally

`Chapter.aiAcceptedWords` / `aiDraftedWords` (see `src/lib/text.ts` `aiInvolvement`) are cumulative counters, not derived from `content`: accepting a Ciciro suggestion drops its authorship marks (`resolveSuggestions`), so the word count has to be taken at that moment (`ciciroAcceptedWordCount` in `src/lib/suggestions.ts`, called from every accept path, web and mobile) and added, permanently - a later edit or deletion never moves or removes it. The same applies to text Ciciro inserts with no suggestion to accept (`insert_text`, a chat `<draft>` paste): tallied once, at insertion. Do not try to reconstruct these from `content` later.

## Model defaults

`src/lib/anthropic.ts` and `src/lib/fast-lane.ts` pin the models Ciciro runs on; `src/lib/models.ts` resolves them (env override or default) for the `/api/models` endpoint that Settings (web and mobile) reads. Changing a default requires a line in `docs/CHANGELOG.md` recording the new default, since Settings is a user's only visibility into which model they're on.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
