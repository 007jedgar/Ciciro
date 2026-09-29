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

`apps/mobile` patches `react-native-enriched-html` (`paragraphSpacing`, both platforms) through `patch-package` in `apps/mobile/patches/`. `npx patch-package react-native-enriched-html` (diff mode) can silently drop hunks when `node_modules` is already patched from a prior run - reinstall the package fresh (`rm -rf node_modules/react-native-enriched-html && npm install react-native-enriched-html@<version> --no-save --ignore-scripts`) before regenerating, or hand-edit the patch file directly and apply it with `node node_modules/.bin/patch-package` (bare, no package arg) to verify it. Any native change needs a rebuilt dev client.

## Production D1 schema

`prisma db push` never reaches the Worker's D1. A schema change needs a `prisma/d1-*.sql` upgrade (see `docs/hosting.md`) applied to production before merging to `main`; the `main` build fails while D1 is behind (`npm run db:check:d1`).

## Web motion

Durations and easings are tokens in `src/app/globals.css`, all scaled by `--motion`, which the reduce-motion setting and the OS preference set to 0; build on them, not on literal `ms`. JS waits on the exit times in `src/lib/motion.ts` (`test/motion.test.ts` fails when they drift from the tokens). A surface that animates out mounts through `Presence` or `usePresence`. Deleting something uses `useSnackbar` with `onCommit`, so the server hears about it only once Undo has lapsed.

## Mobile motion

Pass numbers into Reanimated worklets as arguments or same-scope locals: a default parameter or imported constant used inside one can be missing on the UI runtime. A throw there stops every animation until the app restarts, so if motion "does nothing" on the simulator, read Metro's log and relaunch before debugging the code. The same applies to functions: Reanimated only auto-workletizes the callback passed directly to a hook like `useAnimatedStyle`, not a plain function imported from another module and called inside that callback - give the imported function its own `"worklet"` directive, or it crashes every animation with `[Worklets] Tried to synchronously call a Remote Function`.

On Android, `useReanimatedKeyboardAnimation()`'s `progress` is boolean (0/1 on the IME inset's visibility), not continuous - a floating IME add-on shorter than a real keyboard (the stylus-handwriting toolbar, voice-typing's compact strip) still pins it to 1. Gate keyboard-reactive UI on the paired `height` value too (see `keyboardCoversTabBar` in `apps/mobile/lib/manuscript-tab-bar.ts`) or it disappears whenever one of those shows.

## AI-involvement tally

`Chapter.aiAcceptedWords` / `aiDraftedWords` (see `src/lib/text.ts` `aiInvolvement`) are cumulative counters, not derived from `content`: accepting a Ciciro suggestion drops its authorship marks (`resolveSuggestions`), so the word count has to be taken at that moment (`ciciroAcceptedWordCount` in `src/lib/suggestions.ts`, called from every accept path, web and mobile) and added, permanently - a later edit or deletion never moves or removes it. The same applies to text Ciciro inserts with no suggestion to accept (`insert_text`, a chat `<draft>` paste): tallied once, at insertion. The percentage's denominator, `wordsAdded`, is tallied the same way inside the op log's commit (`tally` in `src/lib/chapter-ops.ts`): a server-side writer that lands new Ciciro prose passes `tally: "drafted"`, one that restores old text passes `"none"`. Do not try to reconstruct any of these from `content` later.

## Checks with structured findings

A quick action (`src/lib/prompts.ts`) can be `kind: "panel"` instead of the default `"chat"`: `ChatPanel` calls a callback prop instead of sending a chat prompt, so the chip can open a dedicated drawer with its own API route and lib module (see `continuity-check` / `src/lib/continuity.ts` + `continuity-view.ts`, alongside `RepetitionPanel`/`WeeklyReview`) rather than routing through the agentic editor chat. A finding's exact quote becomes a jump-to link by opening `SearchPanel` pre-filled with that text (`onInspect` in `Workspace.tsx`) rather than building new anchor/scroll plumbing. Keep the LLM-facing side of such a check bounded and cheap: one non-agentic `DRAFTER_MODEL` call per unit of work (not the `EDITOR_MODEL` chat loop), sending only the bible files relevant to what's being checked, and re-verify any quoted text is an actual substring of what was sent before surfacing it (a model can still paraphrase despite instructions not to).

## Model defaults

`src/lib/anthropic.ts` and `src/lib/fast-lane.ts` pin the models Ciciro runs on; `src/lib/models.ts` resolves them (env override or default) for the `/api/models` endpoint that Settings (web and mobile) reads. Changing a default requires a line in `docs/CHANGELOG.md` recording the new default, since Settings is a user's only visibility into which model they're on.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
