# Analytics

Product analytics, with PostHog as the first (and so far only) provider.
This doc is the tracking plan and the privacy rules; [hosting](hosting.md#analytics)
has the environment variables and account setup.

## Architecture

Every call site, web and mobile, imports only `AnalyticsAdapter` and the event
catalog, never a vendor SDK:

- `src/lib/analytics-events.ts` and `apps/mobile/lib/analytics-events.ts` are
  the shared source of truth: the `EventCatalog` type (every event name and
  its typed properties), the `AnalyticsAdapter` interface, a `NoopAnalyticsAdapter`,
  and a `MemoryAnalyticsAdapter` for tests. The two files must stay
  byte-for-byte identical (`test/analytics-events-parity.test.ts`), the same
  convention `src/lib/manuscript.ts`/`suggestions.ts` use (see AGENTS.md "Code
  the phone shares") - the Expo app cannot import from the Next app, so the
  catalog is mirrored, not shared at the module level.
- `test/analytics-adapter.test.ts` runs the same call-site logic against
  `MemoryAnalyticsAdapter`, a second, independently-written fake adapter, and
  `NoopAnalyticsAdapter`, to prove business code depends only on the interface.
  Swapping PostHog for Firebase or anything else later means writing one new
  adapter per platform that implements `AnalyticsAdapter`; no call site changes.
- PostHog adapters: `src/lib/analytics-posthog-web.ts` (posthog-js, browser),
  `src/lib/analytics-posthog-server.ts` (HTTP Capture API, no SDK, for
  Workers), `apps/mobile/lib/analytics-posthog-native.ts` (posthog-react-native).
- Entry points: `src/lib/analytics-client.ts` / `apps/mobile/lib/analytics-client.ts`
  (browser/app singleton, no-op with no key configured) and
  `src/lib/analytics-server.ts` (`captureServerEvent`, `deleteAnalyticsPerson`,
  `analyticsOptedOut`, also no-op with no key).
- Server sends never block or fail a request: they go through
  `waitUntilRequest` (`src/lib/db.ts`) and `captureServerEvent` swallows every
  error internally.
- Screen tracking: `trackScreenView` in the catalog file returns a
  `{ leave, pause, resume }` `ScreenView`. `leave()` fires `screen_duration`
  on a route change; `pause()`/`resume()` commit and restart the clock when
  the screen stops or starts being actually visible, since a screen_duration
  fired only on route change would lose the very last screen of a session
  (closing a tab or the app never runs that cleanup) and would inflate
  across time spent backgrounded. Web (`src/components/AnalyticsProvider.tsx`)
  wires `pause`/`resume` to `visibilitychange`/`pagehide`, starting screen
  tracking only once `/api/auth/me` has answered so `/` is never miscounted
  as `landing` for a signed-in author; a `pause()`-triggered send asks the
  adapter for a beacon-safe transport (`track(..., { beacon: true })`,
  `posthog-js`'s `sendBeacon`) since it can fire right before the tab closes.
  Mobile (`apps/mobile/components/AnalyticsSync.tsx`) wires them to
  `AppState` background/inactive and active, through the same
  inject-the-listener pattern as `listenWhenActive` in `sync-engine.ts`
  (`pauseResumeOnAppState`), for testability without mocking React Native.

## Privacy rules

These are enforced in code, not just convention:

- **Identity by internal user id only.** `identify()` never receives email,
  name, or any other PII (`AnalyticsAdapter.identify(userId, properties?)` -
  `PersonProperties` is platform/version/plan/signup metadata only).
- **No manuscript, chat, or title content, ever.** Every event's properties
  are counts, enum-like strings (`format`, `surface`, `plan`, `kind`), or
  booleans. None carry free text a user wrote.
- **Session recording is never enabled.** Not configured in any adapter;
  mobile never installs the separate session-replay plugin package.
- **Autocapture of input values is off.** Web's `posthog-js` autocapture is
  scoped to `click`/`submit` DOM events only (`dom_event_allowlist`), so form
  field contents are never captured incidentally, and it masks every
  element's text and attributes (`mask_all_text`, `mask_all_element_attributes`),
  since a clicked project card or button can show a title or prose. Mobile
  has no autocapture at all.
- **Reset on sign-out, alias on sign-up.** Web sign-out (`AccountBar.tsx`)
  calls `signOutAnalytics` (`AnalyticsProvider.tsx`), which ends the open
  screen view while the account is still identified and then resets; mobile
  resets through `followIdentity` in `session.tsx` once the session's user
  clears. Either way the next identity doesn't inherit the previous person's
  anonymous activity. PostHog's own anonymous-to-identified aliasing on the next
  `identify()` ties pre-signup activity (landing page views, `cta_clicked`) to
  the account once it exists. Nothing else resets: `followIdentity` (in
  `analytics-events.ts`) resets only on a real signed-in to signed-out (or
  account-switch) change, never for an anonymous visitor, and both PostHog
  adapters re-register the super properties (`platform`, `release`) after a
  reset.
- **Opt-out, not opt-in, and on by default.** `analyticsEnabled` in
  `AppSettings` (web `src/lib/settings.ts`, mobile `apps/mobile/lib/app-settings.ts`)
  defaults to `true`. This is first-party product analytics about how the
  product is used, not third-party ad tracking or cross-app data sharing, so
  it is outside the scope of Apple's App Tracking Transparency (no ATT
  prompt is needed or shown for it) - see "App Store privacy" below.
- **Account deletion asks PostHog to forget the person.** The
  `posthog-delete-person` `PRE_DELETE_HOOK` (`src/lib/account/delete.ts`,
  see [docs/account-data.md](account-data.md)) is best-effort: it catches its
  own errors and never blocks deletion.
- **A/B tests, feature flags, session replay, and PostHog dashboards are out
  of scope** for this integration. Nothing here blocks adding them later;
  they just weren't built.

## Tracking plan

What each requested metric is answered with, and the PostHog insight type
that answers it. "Trends" and "Funnels" are PostHog's own insight types.

| Metric | Events | PostHog insight |
| --- | --- | --- |
| Conversion rate (visit -> account) | `screen_duration` (`landing`) -> `account_created` | Funnel: landing viewed -> signup screen -> `account_created` |
| Conversion rate (trial/free -> paid) | `paywall_viewed` -> `paywall_cta_clicked` -> `checkout_started` -> `subscription_purchased` | Funnel across those four steps, breakdown by `surface` |
| Click-through rate, any CTA | `cta_clicked` (`cta`, `surface`, `source?`) | Trends: count of `cta_clicked`, breakdown by `cta` or `surface` |
| Time spent per screen | `screen_duration` (`screen`, `durationMs`) | Trends: average/sum of `durationMs`, breakdown by `screen` |
| Time to first manuscript | `account_created` -> `project_created` (`isFirstProject: true`) | Funnel with "time to convert" between the two steps |
| Days to set up a reminder | `account_created` -> `reminder_enabled` | Funnel with "time to convert", bucketed in days |
| Feature usage, any feature | the feature-usage events below | Trends: count per event, breakdown by event name; or a Funnel from `account_created` to first use of a given feature, for adoption |
| Subscription lifecycle | `subscription_purchased` / `subscription_renewed` / `subscription_canceled` / `subscription_ended` (`plan`, `platform`, `interval?`) | Trends over time, breakdown by `plan`/`platform`; a Lifecycle insight for net new/churned |
| Retention | any event, typically `screen_duration` or `chat_message_sent` as the "active" signal | Retention insight, cohorted by `account_created` week |
| Impact of a change on usability/retention/subscriptions | any of the above, filtered or broken down by the `release` super property | Trends/Funnel/Retention with a `release` breakdown or filter, comparing before/after a `CICIRO_RELEASE` value |

`cta_clicked` is declared in the catalog but has no call site yet: it needs a
per-button survey of marketing surfaces (landing page, pricing page) to
decide which buttons count as a CTA, which is deliberately scoped out of
this pass to avoid guessing at marketing copy. Wiring it is a small,
isolated follow-up against the existing catalog entry.

## Feature-usage event inventory

Every event, what fires it, and on which platform(s). "Both" means the call
site exists on web and mobile, firing the same event name with the same
property shape.

| Event | Fires on | Platform |
| --- | --- | --- |
| `project_created` (`kind`, `isFirstProject`) | Creating a new (non-imported) manuscript. `isFirstProject` is computed server-side in `createProject` (a count of the account's existing projects taken atomically with the create), never client-side, so neither platform races its own project list | Both |
| `chat_message_sent` | Sending a typed chat message (not quick actions, not resumed turns) | Both |
| `quick_action_used` (`action`, `kind`) | Running a quick-action chip. Web's `action` is the shared `src/lib/prompts.ts` action id; mobile's is its own smaller `continue`/`rewrite`/`describe` set - the two are not the same vocabulary | Both |
| `autowrite_used` | Starting an Auto-draft run | Web only (no mobile Autowrite UI exists; see AGENTS.md) |
| `suggestion_accepted` / `suggestion_rejected` | Resolving one or all tracked-change suggestions | Both |
| `continuity_check_run` | A continuity check completes | Web only (web-only feature) |
| `repetition_report_viewed` | The repetition report loads | Web only (web-only feature, AGENTS.md) |
| `weekly_review_viewed` | A weekly review is generated | Both |
| `search_performed` | A manuscript search executes | Both. Mobile fires once per debounced keystroke, same as web; not deduplicated per "search session" |
| `share_link_created` | A beta-reader share link is created | Both |
| `export_completed` (`format`) | A manuscript or chapter export's share sheet/download succeeds | Both |
| `snapshot_restored` | Restoring a chapter snapshot (not the undo-of-restore) | Both |
| `writing_sprint_completed` (`durationMinutes?`) | A writing sprint ends (timeout, early end, or foreground catch-up) | Mobile only (sprints are a mobile-only feature) |
| `outline_reordered` | Chapters are reordered (drag or arrow buttons) | Both |
| `story_bible_edited` (`file`) | Saving one of the four core bible files (`canon`/`plot`/`style`/`timeline`) | Both. Editing a character or plot-thread file (`characters/*.md`, `plot/*.md`) through the same editor does not fire this - the catalog's `file` union is the four core files only |
| `character_created` | Adding a character from the bible index | Both |
| `dictation_used` | Starting voice dictation | Both |
| `read_aloud_used` | Starting (not resuming) read-aloud playback | Both |
| `focus_mode_used` | Turning focus mode on (not off) | Both. Typewriter mode is a related but separate setting with no event of its own - toggling it is not tracked |
| `import_completed` (`source`) | A manuscript or chapter import succeeds; `source` is the file extension | Both |
| `style_analysis_viewed` | A style analysis completes | Web only (no mobile Style Analysis UI) |
| `recap_viewed` | A "Previously on" recap or an "I'm stuck" prompt set loads | Web only (no mobile recap/stuck-prompts UI) |
| `scratchpad_used` | Web: creating a new scratch note. Mobile: a scratch note's debounced autosave succeeds | Both, but at different moments - see "Known gaps" |
| `social_sign_in_used` (`provider`) | Completing an Apple/Google sign-in | Both |
| `push_notification_opened` (`type`) | Tapping a push notification (currently only `writing_reminder`) | Mobile only |
| `run_completed` (`surface`, `status`) | A server-executed editor run (chat) finishes | Server-side, fires regardless of platform |

Identity, lifecycle, conversion, and billing events (`account_created`,
`signed_in`, `signed_out`, `paywall_viewed`, `paywall_cta_clicked`,
`checkout_started`, `purchase_cancelled`, `subscription_purchased`,
`subscription_renewed`, `subscription_canceled`, `subscription_ended`,
`reminder_enabled`, `reminder_disabled`, `account_exported`) are covered by
the identity, billing-webhook, and settings code paths directly; see the
catalog file's comments for exactly where each fires.

`subscription_canceled` and `subscription_ended` are two distinct moments,
not one, because they mean different things on each store: `subscription_canceled`
fires when auto-renew turns off and Pro keeps running until the period ends
(RevenueCat `CANCELLATION`; Stripe `customer.subscription.updated` newly
scheduling an end, via `newlyScheduledCancellation` in `src/lib/billing/stripe.ts`,
the same moment the cancellation email fires). `subscription_ended` fires
when access is actually gone (RevenueCat `EXPIRATION`; Stripe
`customer.subscription.deleted`). A web user who turns off auto-renew
without later finishing the period, and a store `EXPIRATION`, now both fire
the event that matches what actually happened, so a Lifecycle insight
compares the same moment across platforms.

## Known gaps (documented, not fixed in this pass)

- **`cta_clicked`** is declared but unused; see above.
- **Email link clicks and widget glances have no event.** Email templates
  carry no attribution query param, and `apps/mobile/lib/writing-widget.ts`'s
  deep link is byte-identical to any other navigation to the same route, so
  neither "opened from an email" nor "opened from the widget" is
  distinguishable from a normal screen open today. Adding either needs a
  product decision to append a tracking param (e.g. `?src=widget`), not just
  an analytics call.
- **Mobile `search_performed`** fires once per debounced query, like web;
  flagged in case "number of searches" should mean something coarser.
- **Mobile vs. web `scratchpad_used` timing differs**: web fires on note
  creation, mobile fires on autosave (mobile's creation path has no distinct
  "new note" moment worth separating from the first save). Both answer
  "scratchpad was used"; neither is wrong, but they are not the same instant.
- **`story_bible_edited`'s `file` type** covers only the four core bible
  files. Character and plot-thread file edits use the same save path on both
  platforms but are not tracked, to avoid widening the catalog's typed union
  for a metric nobody asked for yet.

## Owner setup checklist

1. Create a PostHog project. Pick US or EU data residency up front; it
   cannot be changed later without migrating to a new project.
2. Follow [hosting.md#analytics](hosting.md#analytics) to set the project
   API key (web + mobile + server), and optionally the personal API key for
   account-deletion person-delete.
3. In the PostHog project settings: confirm session recording is off
   (nothing here ever turns it on, but it is a project-level toggle a future
   person could flip) and autocapture is left at PostHog's defaults for
   elements, since this integration's own `dom_event_allowlist` already
   narrows what the web SDK captures.
4. Build the insights from the tracking plan above as PostHog dashboards,
   once there is real traffic to look at. This repo intentionally ships no
   PostHog dashboard configuration (out of scope - dashboards are a PostHog
   project asset, not code).
5. `CICIRO_RELEASE` is optional but worth setting from CI (e.g. the git SHA)
   once this ships, so a before/after release comparison is possible from
   day one rather than retrofitted later.
6. Confirm the RevenueCat webhook (Project settings -> Integrations ->
   Webhooks) is configured to deliver `EXPIRATION` events, not just purchase
   and cancellation ones - `subscription_ended` on iOS/Android depends on it,
   and this repo cannot verify or change that dashboard setting itself. The
   Stripe side needs no equivalent check: `customer.subscription.updated` and
   `customer.subscription.deleted` are already handled events the webhook
   endpoint receives today.

## App Store privacy label notes

For the App Store "App Privacy" (nutrition label) questionnaire:

- **Data collected**: "User ID" (the internal account id, used for
  Analytics). No "Name", "Email Address", or "User Content" category applies
  to this integration, since none of those are ever sent.
- **Purpose**: "Analytics" and, if the questionnaire asks separately,
  "App Functionality" do not apply here - PostHog event data is used only
  for analytics, not to functionally drive the app.
- **Linked to the user**: Yes (the PostHog person is identified by the
  account's internal id while signed in).
- **Used for tracking**: No. "Tracking" in Apple's definition is
  linking data with third-party data for ads or sharing with a data broker;
  this integration does neither, so it does not require an ATT prompt and
  should be marked "not used for tracking".
- The privacy policy should mention PostHog as a sub-processor for product
  analytics, alongside Stripe/RevenueCat/Resend/Anthropic if they are
  already listed there.
