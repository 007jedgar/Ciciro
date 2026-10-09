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

The Expo app cannot import from the Next app, so `src/lib/manuscript.ts` and `src/lib/suggestions.ts` have byte-for-byte copies in `apps/mobile/lib/`. Change both; `test/manuscript-parity.test.ts` and `test/suggestions-parity.test.ts` fail when they drift. Pending tracked changes live inline in chapter HTML; see `docs/tracked-changes.md`. `src/lib/prompts.ts`'s quick-action briefs are copied (not byte-for-byte: the phone drops the panel chips and keeps ids, scopes and prompts) into `apps/mobile/lib/quick-actions.ts`, pinned by `test/quick-actions-parity.test.ts`; a new chip needs a `quickActions.<id>` label in all four locales. Not every pure `src/lib` module needs a mobile mirror - only add one, plus a parity test, when mobile actually gains a surface that uses it (e.g. `src/lib/repetition.ts` is web-only today; there is no mobile Repetition screen).

## Pre-signup onboarding (mobile)

Between the welcome screen's "Create" and signup sits a mobile-only quiz: `onboarding-goal.tsx` (kind, `MANUSCRIPT_KINDS`) → `onboarding-obstacle.tsx` (one or more obstacles, `lib/onboarding.ts`'s `OBSTACLES`; "Not sure yet" stands alone) → `onboarding-look.tsx` (Pick a look) → `onboarding-demo.tsx` → `onboarding-reminder.tsx` (only when "consistency" is among the obstacles) → signup. The demo is whichever of the two AI-free demos `demoForAnswers` maps the answers to (most obstacles' vote, ties to the first tapped; `components/onboarding/FocusDemo.tsx` is the real `ChapterEditor` on a page of prose you can scroll and type in, `SuggestionsDemo.tsx` the real `SuggestionsReview`), against throwaway local state - no AI or server call anywhere, and journal never shows invented sample content (it always gets Focus, on a blank page). Every screen has a Skip straight to signup, and every screen shows the `OnboardingThread` (steps from `stepsFor` in `lib/onboarding-flow.ts`, which also owns the route params).

Nothing is persisted until signup creates an account. The answers and the held reminder (device-local, scheduled by `WritingReminderSync`) travel as route params; the previewed theme does not, it lives only in memory (`useThemePreview`: the app wears it but it is never cached or synced, so signing in to an existing account cannot overwrite that account's settings) and is the single source of what gets adopted. `AuthScreen`'s `signedIn` saves the answers on any signup but the theme (`adoptPreview`) and reminder only when the sign-in `created` the account (the email signup always does; the social paths report it, since a social sign-in on that screen can land on an existing account). An abandoned quiz persists nothing. The reminder step asks for notification permission on Create reminder, and a denied answer still keeps the reminder. A theme change anywhere (this step, Settings' `ThemeCard` sheet) goes through `useThemeChange`, a circle that grows from the tapped card and reveals a snapshot of the screen already repainted in the new theme (`ThemeWashScope`, mounted at the root and again inside Settings, which sits above the root as a modal). Signing in or up fades the auth screen out and the manuscripts list in, rising (`lib/auth-arrival.ts`), with the submit button's label crossfading to `InlineDots`. A new demo path needs an entry in `lib/onboarding.ts` and a component; a new obstacle or kind option needs i18n in all four locales plus the matching analytics events in both `analytics-events.ts` copies.

## Patched native editor

`apps/mobile` patches `react-native-enriched-html` (`paragraphSpacing`, both platforms) through `patch-package` in `apps/mobile/patches/`. `npx patch-package react-native-enriched-html` (diff mode) can silently drop hunks when `node_modules` is already patched from a prior run - reinstall the package fresh (`rm -rf node_modules/react-native-enriched-html && npm install react-native-enriched-html@<version> --no-save --ignore-scripts`) before regenerating, or hand-edit the patch file directly and apply it with `node node_modules/.bin/patch-package` (bare, no package arg) to verify it. Any native change needs a rebuilt dev client.

The native view treats a changed `defaultValue` (and `setValue`) as a whole-buffer replace that parks the caret at the end of the chapter, so `ChapterEditor` fixes `defaultValue` per chapter and every later write goes through its guarded sync effect; a caller that must rewrite the buffer restores the caret with `setSelection` (see `acceptGrammar` in `manuscript.tsx`).

`ChapterEditor`'s `<EnrichedTextInput key={chapterId}>` remounts a fresh native view on every chapter switch, but `ChapterEditor` itself keeps one React instance, so any effect that captures the native ref (`registerEditor`, used to set `manuscript.tsx`'s `editorRef`) needs `chapterId` in its own deps - gating it on the ref-setter alone runs it once for the whole component lifetime and leaves the screen holding a ref to a long-unmounted view, which makes `flush()`'s `editor.getHTML()` reject forever after the first switch.

## Home-screen widget (expo-widgets)

`apps/mobile/widgets/WritingDayWidget.tsx` runs in a separate, worklet-like extraction: only the single function tagged `"widget"` and passed to `createWidget` is captured for the widget extension's runtime. A sibling helper component defined in the same file (even with its own `"widget"` directive) is out of scope at render time and throws `ReferenceError: Can't find variable: <name>` - inline any shared JSX directly in the tagged function instead of factoring it into a separate component. The widget extension's JS is compiled in at native build time (Xcode's "Bundle React Native code and images" phase), not hot-reloaded by Metro, so a change here needs a rebuild (`npx expo run:ios`) before it shows in the widget gallery preview, and widget changes only reach users with a new native build (never an OTA update). See `docs/mobile-release.md` for the release pipeline.

## Production D1 schema

`prisma db push` never reaches the Worker's D1. A schema change needs a `prisma/d1-*.sql` upgrade (see `docs/hosting.md`) applied to production before merging to `main`; the `main` build fails while D1 is behind (`npm run db:check:d1`). Only add tables and columns there: D1 cannot turn foreign keys off, so rebuilding a referenced table (the only way SQLite drops NOT NULL or changes a type) cascade-deletes its children. Model "no value" with a default instead (e.g. `User.passwordHash = ""` for Apple / Google accounts).

## Prisma on Workers

Each hosted request gets its own `PrismaClient` (`src/lib/db.ts`: one isolate-wide client caused Cloudflare 1101s), and each client's WASM engine stays in memory until `$disconnect()`, about 0.5 MB per request against the isolate's 128 MB. The Worker entry frees it once the body and every `waitUntil` / `after()` have settled, counting a body the runtime stopped reading as done after `QUIET_MS` without a chunk (`src/worker/request-lifetime.ts`); never drop that, or wrap `fetch` in a client of its own. A handler that holds a long-lived stream open after its last query calls `releaseRequestPrisma()` (see `/api/sync/stream`). A stream producer that keeps querying after a client disconnect registers its work with `waitUntilRequest()` (see `/api/chat`), or the request ends at the disconnect and frees its client mid-run.

## Account data

Every Prisma model must be both purged by account deletion and written by the data export (`src/lib/account/`, see `docs/account-data.md`); `test/account-delete.integration.test.ts` and `test/account-export.integration.test.ts` fail when a new model is missing from either. Outside-service cleanup at deletion (Stripe cancel, Apple token revoke) goes in `PRE_DELETE_HOOKS`, not the route. A model no account owns (`BetaSignup`, the landing page's iOS beta list) goes in `UNOWNED_MODELS` (`src/lib/account/delete.ts`) instead.

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

Pushed screens slide in (and pop out) in `StackPopTransition`, not through the native stack's `animation`: a transparent-modal presentation, which the collapse-on-back needs, gets a vertical cover from UIKit, never a sideways push. An animation that starts from a screen's mount effect is partly or wholly spent behind the heavy first render, so start it from `useTimingOnFirstFrame` (`lib/use-timing-on-first-frame.ts`), which counts only frames that were drawn, and for a pushed screen from the stack's `transitionEnd`, once the view is on show; an entrance inside a pushed screen waits for that push through `useStackArrival` (`lib/stack-arrival.ts`), not its own mount. Tab slides are `sceneStyleInterpolator`/`transitionSpec` on the `(tabs)` navigator (`lib/manuscript-tab-slide.ts`); progress is signed by side, so direction needs no tracking.

On Android, `useReanimatedKeyboardAnimation()`'s `progress` is boolean (0/1 on the IME inset's visibility), not continuous - a floating IME add-on shorter than a real keyboard (the stylus-handwriting toolbar, voice-typing's compact strip) still pins it to 1. Drive keyboard-reactive UI from the paired `height` value instead, ramped continuously so there is no step (see `keyboardHideProgress` in `apps/mobile/lib/manuscript-tab-bar.ts`), or it disappears whenever one of those shows.

An `Animated.FlatList`'s `itemLayoutAnimation` (list-level reflow) must not be left on unconditionally: react-native-screens detaching and reattaching a screen's native view (any push-then-pop, e.g. opening a manuscript's chapters and going back) can replay the layout transition from a stale pre-detach layout, landing real rows collapsed - items vanish with no change to the underlying data. `apps/mobile/app/manuscripts.tsx`'s `layoutAnimating` is the pattern: on for the first reveal and for a render that changes the rows while the screen is focused (`useIsFocused`), off while blurred and on a render whose rows are unchanged, with rows that arrive while blurred never sliding in.

A shared-title morph (`lib/shared-title-morph.tsx`, see `manuscripts.tsx`'s row → chapters-header title) listens for the stack pop with `navigation.addListener("beforeRemove", ...)` to play its reverse animation. A header several navigators below the one performing the removal (the manuscript's chapters screen sits under its own `project/[id]` Stack, itself nested in a `(tabs)` Tabs navigator) never sees that event on its own `useNavigation()` - only the navigator that actually owns the removal does (`ownsStackRemove` in `stack-pop.ts`). `MorphHeaderTitle` listens on every ancestor up to the root and lets each one's own `ownsStackRemove` check decide, the same pattern `StackPopTransition` uses by having one instance per nesting level.

## Mobile press feedback

Every button answers a finger through one engine, `apps/mobile/lib/use-press-feedback.ts` (tokens in `lib/motion.ts`: 90ms in, 180ms out, scale `PRESS_SCALE`, dim `PRESS_DIM`). `TapPressable` and `PressableCard` are its consumers, and so is any custom surface that needs it: call `usePressFeedback({ feedback, scale, dim, restOpacity, tint })` and merge `animatedStyle` after your own style (`dim: 1` keeps the dip without the dim, as `ThemeCard` does so its swatch stays true). Use `TapPressable` for a button, never a raw `Pressable` with a `({ pressed }) => ...` style (`TapPressable`'s `style` has no function form, so TypeScript rejects it there). Pick `feedback="scale"` (default) for anything with a surface, `"dim"` for a bare text link or icon, `"none"` for a scrim, and `highlight` + `feedback="none"` for a full-bleed list row. `haptic="select"` is for choosing among options, `"none"` when the handler fires its own haptic (never tap twice). A choice control uses `SelectChip` (crossfade and pop via `useSelectionPop`), not a hand-cut selected style. Reduce motion drops the scale and keeps the dim and tint.

## Motion: prefer completable animations

Reach for animation that has a visible beginning and end the person can complete (a ring that closes, a tick that draws, a thread that fills, a line that finishes typing) over open-ended step-to-step indicators (dots, spinners, bare counts). Onboarding's progress thread was chosen because it is the only option that starts empty and ends complete; dots only went step to step, and a count never makes you want to finish. When adding or touching motion, look for the completable form first: `ProgressRing` and `DrawCheck` are the building blocks, and a finished act (goal met, sprint over, export ready) should land on a closed ring or a drawn tick, not on a stopped spinner. No streaks or loss framing anywhere: writing frequency is a calm count of days written (`lib/writing-frequency.ts`).

## Mobile themes and fonts

The phone's themes live in `apps/mobile/lib/theme.ts` and `DEFAULT_THEME` ("ciciro", the web's Archive look) is the fallback everywhere. Stored theme ids are permanent: renaming a theme changes only its label (`THEME_META` and the `themes.*` keys in all four locales), never its id. The theme setting syncs to the server and web, so `src/lib/theme.ts` lists the phone-only ids (`PHONE_THEME_IDS`): the server stores them as sent and the web renders its own default of that mode through `webTheme`. A new phone-only theme goes in both lists. The server's "parchment" for an account that never saved settings is not a pick: `GET /api/settings` and `/api/auth/me` report `settingsSaved`, and `withPhoneDefaultTheme` (`apps/mobile/lib/app-settings.ts`) shows the phone default only when that is `false`, never when it is unknown.

The chrome fonts (Newsreader, Instrument Sans, JetBrains Mono) are embedded at build time by the `expo-font` plugin in `app.json`, so a font change needs a new native build and `fonts.*` use a different native name per OS (iOS PostScript name, Android file name). `fonts.serif`, the manuscript's own face, is separate.

## Mobile haptics

Every haptic goes through `apps/mobile/lib/haptics.ts`, never `expo-haptics` directly, so the device-local Settings switch (local prefs like focus mode, default on) silences all of them. Buttons and pills use `TapPressable` (`apps/mobile/components/TapPressable.tsx`), and other shared pressables (`PressableCard`, Settings rows) wrap their handler in `withTap`; the chat stream ticks via `createWritingTicker` and ends with `success()`/`warning()` in `use-ciciro-chat.ts`. A completion moment (goal met, sprint finished) uses `haptics.celebrate()`, never a hand-rolled pair of haptics.

## Mobile screen error recovery

A mobile screen whose content comes from a query (not a one-off action) renders its failed/empty state with `ScreenErrorState` (`apps/mobile/components/ScreenErrorState.tsx`), never a bare error `Text`: a friendly message, Try again, and Restart app (`apps/mobile/lib/app-restart.ts`'s `restartApp`, offered only once a retry has already failed) with the server's raw text behind a "Details" toggle rather than in the headline. Wrap the screen's default export in `ScreenErrorBoundary` so a render crash gets the same recovery UI instead of a dead screen. A background refetch failure must not blank a screen that still has cached data to show - keep showing it next to an inline (`variant="inline"`) banner, same as `manuscripts.tsx` and the chapters tab do; reserve the full (`variant="full"`) state, as the list's `ListEmptyComponent`, for when there is nothing cached. Pull-to-refresh stays wired regardless of error state.

## Mobile accessibility

iOS ignores `role="alert"` and `accessibilityLiveRegion` on content that appears, so status text that lands off-focus is spoken with `announce()` (`apps/mobile/lib/announce.ts`). Error text uses `AlertText`, which announces itself. Touchables default to the button role (`TapPressable`, `PressableCard`), so pass `accessibilityRole` only to override it. Text colours must clear 4.5:1 and text-field outlines 3:1 on every theme: the `field` token exists for that, and `__tests__/theme.test.ts` fails when a palette drifts below it.

## AI-involvement tally

`Chapter.aiAcceptedWords` / `aiDraftedWords` (see `src/lib/text.ts` `aiInvolvement`) are cumulative counters, not derived from `content`: accepting a Ciciro suggestion drops its authorship marks (`resolveSuggestions`), so the word count has to be taken at that moment (`ciciroAcceptedWordCount` in `src/lib/suggestions.ts`, called from every accept path, web and mobile) and added, permanently - a later edit or deletion never moves or removes it. The same applies to text Ciciro inserts with no suggestion to accept (`insert_text`, a chat `<draft>` paste): tallied once, at insertion. The percentage's denominator, `wordsAdded`, is tallied the same way inside the op log's commit (`tally` in `src/lib/chapter-ops.ts`): a server-side writer that lands new Ciciro prose passes `tally: "drafted"`, one that restores old text passes `"none"`. Do not try to reconstruct any of these from `content` later.

## Craft defaults

Craft defaults (`src/lib/craft-defaults.ts`, see `docs/craft-defaults.md`) are the opt-in "Experimental writing prompt" setting (`craftDefaults`, off by default), and with it off every prompt must stay byte for byte what it was (`test/craft-defaults.test.ts` pins them). A new path that drafts prose reads `proseOptions(projectId)` (`src/lib/craft-options.ts`: the owner's setting plus the `style.md` em-dash switch, which the drafter cannot see), builds its prompt with `drafterSystemFor(kind, { emDashes, craft })`, and only when `craft` is on runs `checkDraft` so the editor gets a CRAFT CHECK. The em-dash switch works with craft on or off. The defaults never apply to the author's own prose.

## Checks with structured findings

A quick action (`src/lib/prompts.ts`) can be `kind: "panel"` instead of the default `"chat"`: `ChatPanel` calls a callback prop instead of sending a chat prompt, so the chip can open a dedicated drawer with its own API route and lib module (see `continuity-check` / `src/lib/continuity.ts` + `continuity-view.ts`, alongside `RepetitionPanel`/`WeeklyReview`) rather than routing through the agentic editor chat. A finding's exact quote becomes a jump-to link by opening `SearchPanel` pre-filled with that text (`onInspect` in `Workspace.tsx`) rather than building new anchor/scroll plumbing. Keep the LLM-facing side of such a check bounded and cheap: one non-agentic `DRAFTER_MODEL` call per unit of work (not the `EDITOR_MODEL` chat loop), sending only the bible files relevant to what's being checked, and re-verify any quoted text is an actual substring of what was sent before surfacing it (a model can still paraphrase despite instructions not to).

## Who-knows-what ledger

`KnowledgeFact` rows (`src/lib/knowledge.ts`) are the source of truth for the who-knows-what ledger; the mirror block in each `characters/<slug>.md` is derived. The four stances and the story-order rules (`inEffectAsOf`, timeline, topic grid) live in `src/lib/knowledge-ledger.ts`, mirrored byte for byte in `apps/mobile/lib/` (`test/knowledge-ledger-parity.test.ts`). A fact holds from its `chapterId` (null: before the story) until `supersededAtChapterId`; "as of chapter N" compares live `Chapter.order` on both ends, so never cache an order. Every reader of the ledger for a chapter (editor context, continuity check, What changed, the chat tools) goes through `factsAsOfChapter`, not `activeFactsForPaths`, which is the chapter-blind current snapshot. The chat's `record_knowledge` / `read_knowledge` / `revise_knowledge` (`src/lib/knowledge-tools.ts`) are bible writes outside `MANUSCRIPT_WRITE_TOOLS` and default to the run's `activeChapterId`, which both clients send with every turn. Details in `docs/story-bible.md`.

## AI allowance and billing

Every AI entry point is metered on a hosted server (`src/lib/entitlements.ts`, see `docs/billing.md`): a user-initiated action claims one run with `meterAiRun` or `withAiRun` (which refunds on failure), and background or free work checks `aiAllowed`/`assertAiAllowed` so it stops at the limit. A new AI route or lib caller needs one of these, or it bypasses the allowance. Billing UI, web and mobile, renders only the server's entitlement, never Stripe or RevenueCat client state.

## Model defaults

`src/lib/anthropic.ts` and `src/lib/fast-lane.ts` pin the models Ciciro runs on; `src/lib/models.ts` resolves them (env override or default) for the `/api/models` endpoint that Settings (web and mobile) reads. Changing a default requires a line in `docs/CHANGELOG.md` recording the new default, since Settings is a user's only visibility into which model they're on.

A model with `thinking` enabled spends its `max_tokens` budget on thinking too, so a cap sized to the expected output can come back with `stop_reason: "max_tokens"` cut off mid-sentence. Any call that writes prose or a plan (`autowrite.ts`, `dispatch_draft` in `tools.ts`) uses `PROSE_MAX_TOKENS` (`src/lib/prompts.ts`) and treats that stop reason as a failure, not a finished reply - never persist or hand onward text that stopped there. The same check belongs on any call whose raw text return is committed or cached directly (`recap.ts`'s "Previously on" recap, `summarize.ts`'s chapter summary); a call that instead parses JSON out of the reply (`correct.ts`, `continuity.ts`, `weekly-review.ts`) is already safe, since a cut-off reply fails to parse and falls back.

`src/lib/prompts.ts`'s header comment tracks which per-model tuning notes are still live; re-check it against Anthropic's current migration guidance whenever the pinned model changes. On Opus 5.5+, a between-tool-call note longer than a sentence or two arrives as an otherwise-empty `thinking` block - `editor-run.ts`'s stream loop requests `display: "updates"` (beta `thinking-display-updates-2026-08-18`, only for models `src/lib/thinking-display.ts` lists, retried without it on a 400 naming it) and forwards non-empty `thinking_delta`s as `progress` events so authors see them. `ChatPanel.tsx` (web) and `ciciro-stream.ts`/`CiciroChat.tsx` (mobile) render these as an ephemeral, subtly-styled line, never added to the visible reply or the persisted transcript.

## Stopping an editor run

`POST /api/chat/cancel` (`cancelEditorRun` in `src/lib/editor-run.ts`, see `docs/editor-agent-runs.md`) is the only way to stop a durable run; an aborted client fetch alone never does (the claimed slice keeps running and checkpointing). It is checked at iteration boundaries and before each tool call, never mid-stream or mid-tool, so the run finishes whatever it is currently generating or executing before it notices. Both `ChatPanel.tsx` (web) and `use-ciciro-chat.ts` (mobile) must call it from their Stop control - wiring one without the other leaves that surface with the old "Stop does nothing server-side" bug.

## Analytics

Product analytics (PostHog) sits entirely behind `AnalyticsAdapter`, never a vendor SDK, at any call site (`src/lib/analytics-events.ts`, mirrored byte-for-byte in `apps/mobile/lib/` like `manuscript.ts`/`suggestions.ts` above; `test/analytics-events-parity.test.ts` fails when they drift). A new event needs a typed entry in both catalog files before any `track()` call uses it. Never put manuscript text, chat content, titles, or other author prose in an event or property, and identify by internal user id only, never email or name. See `docs/analytics.md` for the tracking plan and feature inventory, `docs/hosting.md#analytics` for env vars and setup.

## Chat edit mode

The chat's Allow edits / Chat only switch is per conversation and enforced on the server per run (`EditorRun.editsAllowed`, `src/lib/edit-mode.ts`, see `docs/editor-agent-runs.md`): a new editor path that can change a chapter must go through `editorToolsFor`/`executeEditorTool`, never its own tool list. `edit-mode.ts` is mirrored in `apps/mobile/lib/` (`test/edit-mode-parity.test.ts`); a new manuscript-writing tool goes in `MANUSCRIPT_WRITE_TOOLS` (both copies), and a new chip that asks Ciciro to change the manuscript sets `writes: true`.

## Brand assets

Every generated icon/mark PNG (web favicon/Apple touch icon, the Expo app icon/splash/Android adaptive icons, and the smaller "mark" badges used in-app - `apps/mobile/components/BrandMark.tsx` - and in transactional emails - `public/brand/email-mark-*.png`) comes from one script, `scripts/generate-brand-icons.mjs`; re-run it after any brand-colour or mark-shape change instead of hand-editing a PNG. A new brand raster gets a case in the script, never a one-off export, or it goes stale at the next redesign.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
