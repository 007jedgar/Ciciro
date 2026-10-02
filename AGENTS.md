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

## Home-screen widget (expo-widgets)

`apps/mobile/widgets/WritingDayWidget.tsx` runs in a separate, worklet-like extraction: only the single function tagged `"widget"` and passed to `createWidget` is captured for the widget extension's runtime. A sibling helper component defined in the same file (even with its own `"widget"` directive) is out of scope at render time and throws `ReferenceError: Can't find variable: <name>` - inline any shared JSX directly in the tagged function instead of factoring it into a separate component. The widget extension's JS is compiled in at native build time (Xcode's "Bundle React Native code and images" phase), not hot-reloaded by Metro, so a change here needs a rebuild (`npx expo run:ios`) before it shows in the widget gallery preview, and widget changes only reach users with a new native build (never an OTA update). See `docs/mobile-release.md` for the release pipeline.

## Production D1 schema

`prisma db push` never reaches the Worker's D1. A schema change needs a `prisma/d1-*.sql` upgrade (see `docs/hosting.md`) applied to production before merging to `main`; the `main` build fails while D1 is behind (`npm run db:check:d1`). Only add tables and columns there: D1 cannot turn foreign keys off, so rebuilding a referenced table (the only way SQLite drops NOT NULL or changes a type) cascade-deletes its children. Model "no value" with a default instead (e.g. `User.passwordHash = ""` for Apple / Google accounts).

## Prisma on Workers

Each hosted request gets its own `PrismaClient` (`src/lib/db.ts`: one isolate-wide client caused Cloudflare 1101s), and each client's WASM engine stays in memory until `$disconnect()`, about 0.5 MB per request against the isolate's 128 MB. The Worker entry frees it once the body and every `waitUntil` / `after()` have settled (`src/worker/request-lifetime.ts`); never drop that, or wrap `fetch` in a client of its own. A handler that holds a long-lived stream open after its last query calls `releaseRequestPrisma()` (see `/api/sync/stream`). A stream producer that keeps querying after a client disconnect registers its work with `waitUntilRequest()` (see `/api/chat`), or the request ends at the disconnect and frees its client mid-run.

## Account data

Every Prisma model must be both purged by account deletion and written by the data export (`src/lib/account/`, see `docs/account-data.md`); `test/account-delete.integration.test.ts` and `test/account-export.integration.test.ts` fail when a new model is missing from either. Outside-service cleanup at deletion (Stripe cancel, Apple token revoke) goes in `PRE_DELETE_HOOKS`, not the route.

## Password-attempt rate limiting

`src/lib/auth/rate-limit.ts` is the one limiter for every password check (login, and the password proof in account deletion): call `assertAttemptAllowed` before verifying the password, `recordFailedAttempt` on a wrong one, `clearAttempts` on success. It counts `PasswordAttempt` rows (D1, not in-memory, so it works across Worker isolates) per account+IP pair, per account, and per hashed IP (`docs/hosting.md` has the limits); a new endpoint that checks a password must go through it too. The email-link endpoints (forgot password, resend verification, reset) check no password: they use the per-account cooldown and single-use tokens in `src/lib/auth/email-tokens.ts`, and a completed reset clears the account's attempts. `PasswordAttempt` is required, not optional, like the other `prisma/d1-*.sql` upgrades (see `docs/hosting.md`).

## Email

A new email is a template in `src/lib/email/templates.ts`, also listed in `emailPreviews` so `/dev/emails` shows it, plus a send in `src/lib/email/account-emails.ts` that never throws and passes an idempotency key (see `docs/hosting.md#email`). Links in emails use `publicOrigin` (`src/lib/public-origin.ts`), never a raw request Host.

## Web motion

Durations and easings are tokens in `src/app/globals.css`, all scaled by `--motion`, which the reduce-motion setting and the OS preference set to 0; build on them, not on literal `ms`. JS waits on the exit times in `src/lib/motion.ts` (`test/motion.test.ts` fails when they drift from the tokens). A surface that animates out mounts through `Presence` or `usePresence`. Deleting something uses `useSnackbar` with `onCommit`, so the server hears about it only once Undo has lapsed.

## Mobile releases and push

`apps/mobile` ships through EAS (`docs/mobile-release.md`). `runtimeVersion` is the fingerprint policy, and `.eas/workflows/deploy-production.yml` publishes every mobile push to `main` as an over-the-air update to production users when a production build with the same fingerprint exists (a new build otherwise), so merged mobile JS reaches authors on their next launch. EAS builds and updates read EAS environment variables, never `.env`; `app.config.ts` refuses a release bundle without a hosted https `EXPO_PUBLIC_API_URL`. A server-sent notification goes through `sendPushToUser` (`src/lib/push/send.ts`), which owns batching, receipts and dead-token cleanup; tokens belong to the session that registered them.

## Mobile motion

Pass numbers into Reanimated worklets as arguments or same-scope locals: a default parameter or imported constant used inside one can be missing on the UI runtime. A throw there stops every animation until the app restarts, so if motion "does nothing" on the simulator, read Metro's log and relaunch before debugging the code. The same applies to functions: Reanimated only auto-workletizes the callback passed directly to a hook like `useAnimatedStyle`, not a plain function imported from another module and called inside that callback - give the imported function its own `"worklet"` directive, or it crashes every animation with `[Worklets] Tried to synchronously call a Remote Function`.

On Android, `useReanimatedKeyboardAnimation()`'s `progress` is boolean (0/1 on the IME inset's visibility), not continuous - a floating IME add-on shorter than a real keyboard (the stylus-handwriting toolbar, voice-typing's compact strip) still pins it to 1. Drive keyboard-reactive UI from the paired `height` value instead, ramped continuously so there is no step (see `keyboardHideProgress` in `apps/mobile/lib/manuscript-tab-bar.ts`), or it disappears whenever one of those shows.

## AI-involvement tally

`Chapter.aiAcceptedWords` / `aiDraftedWords` (see `src/lib/text.ts` `aiInvolvement`) are cumulative counters, not derived from `content`: accepting a Ciciro suggestion drops its authorship marks (`resolveSuggestions`), so the word count has to be taken at that moment (`ciciroAcceptedWordCount` in `src/lib/suggestions.ts`, called from every accept path, web and mobile) and added, permanently - a later edit or deletion never moves or removes it. The same applies to text Ciciro inserts with no suggestion to accept (`insert_text`, a chat `<draft>` paste): tallied once, at insertion. The percentage's denominator, `wordsAdded`, is tallied the same way inside the op log's commit (`tally` in `src/lib/chapter-ops.ts`): a server-side writer that lands new Ciciro prose passes `tally: "drafted"`, one that restores old text passes `"none"`. Do not try to reconstruct any of these from `content` later.

## Craft defaults

Craft defaults (`src/lib/craft-defaults.ts`, see `docs/craft-defaults.md`) are the opt-in "Experimental writing prompt" setting (`craftDefaults`, off by default), and with it off every prompt must stay byte for byte what it was (`test/craft-defaults.test.ts` pins them). A new path that drafts prose reads `proseOptions(projectId)` (`src/lib/craft-options.ts`: the owner's setting plus the `style.md` em-dash switch, which the drafter cannot see), builds its prompt with `drafterSystemFor(kind, { emDashes, craft })`, and only when `craft` is on runs `checkDraft` so the editor gets a CRAFT CHECK. The em-dash switch works with craft on or off. The defaults never apply to the author's own prose.

## Checks with structured findings

A quick action (`src/lib/prompts.ts`) can be `kind: "panel"` instead of the default `"chat"`: `ChatPanel` calls a callback prop instead of sending a chat prompt, so the chip can open a dedicated drawer with its own API route and lib module (see `continuity-check` / `src/lib/continuity.ts` + `continuity-view.ts`, alongside `RepetitionPanel`/`WeeklyReview`) rather than routing through the agentic editor chat. A finding's exact quote becomes a jump-to link by opening `SearchPanel` pre-filled with that text (`onInspect` in `Workspace.tsx`) rather than building new anchor/scroll plumbing. Keep the LLM-facing side of such a check bounded and cheap: one non-agentic `DRAFTER_MODEL` call per unit of work (not the `EDITOR_MODEL` chat loop), sending only the bible files relevant to what's being checked, and re-verify any quoted text is an actual substring of what was sent before surfacing it (a model can still paraphrase despite instructions not to).

## AI allowance and billing

Every AI entry point is metered on a hosted server (`src/lib/entitlements.ts`, see `docs/billing.md`): a user-initiated action claims one run with `meterAiRun` or `withAiRun` (which refunds on failure), and background or free work checks `aiAllowed`/`assertAiAllowed` so it stops at the limit. A new AI route or lib caller needs one of these, or it bypasses the allowance. Billing UI, web and mobile, renders only the server's entitlement, never Stripe or RevenueCat client state.

## Model defaults

`src/lib/anthropic.ts` and `src/lib/fast-lane.ts` pin the models Ciciro runs on; `src/lib/models.ts` resolves them (env override or default) for the `/api/models` endpoint that Settings (web and mobile) reads. Changing a default requires a line in `docs/CHANGELOG.md` recording the new default, since Settings is a user's only visibility into which model they're on.

A model with `thinking` enabled spends its `max_tokens` budget on thinking too, so a cap sized to the expected output can come back with `stop_reason: "max_tokens"` cut off mid-sentence. Any call that writes prose or a plan (`autowrite.ts`, `dispatch_draft` in `tools.ts`) uses `PROSE_MAX_TOKENS` (`src/lib/prompts.ts`) and treats that stop reason as a failure, not a finished reply - never persist or hand onward text that stopped there. The same check belongs on any call whose raw text return is committed or cached directly (`recap.ts`'s "Previously on" recap, `summarize.ts`'s chapter summary); a call that instead parses JSON out of the reply (`correct.ts`, `continuity.ts`, `weekly-review.ts`) is already safe, since a cut-off reply fails to parse and falls back.

`src/lib/prompts.ts`'s header comment tracks which per-model tuning notes are still live; re-check it against Anthropic's current migration guidance whenever the pinned model changes. On Opus 5.5+, a between-tool-call note longer than a sentence or two arrives as an otherwise-empty `thinking` block - `editor-run.ts`'s stream loop requests `display: "updates"` (beta `thinking-display-updates-2026-08-18`, only for models `src/lib/thinking-display.ts` lists, retried without it on a 400 naming it) and forwards non-empty `thinking_delta`s as `progress` events so authors see them. `ChatPanel.tsx` (web) and `ciciro-stream.ts`/`CiciroChat.tsx` (mobile) render these as an ephemeral, subtly-styled line, never added to the visible reply or the persisted transcript.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
