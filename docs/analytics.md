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
  One visit can therefore emit several `screen_duration` events, one per
  visible segment, all sharing the visit's `viewId`. A screen that starts
  already hidden (a background tab, a backgrounded app; `startHidden`) waits
  for its first `resume()` before its clock runs.

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
- **Opt-in consent, per device, where the law asks for it (GDPR/ePrivacy).**
  Analytics storage/access on a device needs affirmative consent before it
  happens in the EU / EEA / UK / Switzerland (and, by the owner's choice,
  California, Washington and Oregon). **Web asks everyone**; **the phone asks
  only there**, and elsewhere in the US analytics is on by default with an
  easy opt-out - see "Where the prompt shows (phone)" below. The
  consent record (`{ version, categories: { analytics }, decidedAt }`) lives
  on the device, never synced: a second device, or a reinstall, has no
  record and is asked again even for an account that already said yes
  elsewhere. `necessary` (session/auth, security, the consent record
  itself) and `functional` (theme, focus mode, editor/reader prefs, chat
  width, unsaved scratchpad drafts - storage the person already asked for)
  are always on and disclosed but not gated by the prompt; only `analytics`
  is a real choice. `marketing` is a reserved category id with no consumer
  or UI yet - bump the version below when it gets one. A stored record from
  an older version means "ask again": bump the shared version constant
  (mobile: `CONSENT_VERSION` in `apps/mobile/lib/consent.ts`) whenever a
  category or its purpose changes.

  The phone's prompt is **Allow (the primary, filled button)** beside
  **Don't allow (the quiet, outlined button)**, same size, one tap each, plus
  a Choose path to the same per-category view, no pre-ticked analytics box,
  no cookie wall - the product works fully with analytics rejected. (Web's
  banner keeps equal-weight Accept all / Reject all.) The copy says plainly
  that the data is only for Ciciro's own analytics, is never sold and is
  never shared with advertisers or data brokers, and that the analytics
  provider (PostHog) processes it on Ciciro's behalf. Keep it true: if a
  second recipient, an ad SDK, or any sharing is ever added, change the
  `consent.*` strings in all four locales and bump `CONSENT_VERSION`.
  Withdrawing is exactly as easy as granting: **Settings > Privacy choices**
  (`app/privacy-choices.tsx`) is a plain on/off switch for analytics, for
  every user everywhere, with the promise above and a link to the privacy
  policy; changing it takes effect at once (`AnalyticsSync` reacts to the new
  record) and is recorded like a choice at the prompt. Web: the landing/
  features footers, the pricing and privacy pages, and a "Cookie settings"
  row in Settings reopen the preference center.

  ### Where the prompt shows (phone)

  `apps/mobile/lib/consent-region.ts` (`consentModeFor`, pure and tested in
  `__tests__/consent-region.test.ts`) turns a coarse location into one of two
  modes:

  | Where | Mode | Behaviour |
  | --- | --- | --- |
  | EU (27), Iceland, Liechtenstein, Norway, UK, Switzerland | opt-in | Prompt after signup; analytics off until Allow |
  | United States: California, Washington, Oregon | opt-in | Same |
  | United States, any other state or DC | opt-out | No prompt; analytics on by default; switch off in Privacy choices |
  | US with no state, any other country (incl. US territories), unknown | opt-in | Same as the first rows: asking when unsure costs one tap |

  The location comes from our own server, not the device:
  `GET /api/app/consent-region` (`src/lib/request-geo.ts`) returns Cloudflare's
  country and, in the US, state for the request's IP - nothing finer, nothing
  stored or logged. `apps/mobile/lib/consent-region-store.ts` looks it up at
  launch and on a foreground return older than 6 hours, caches it in local
  prefs, and stops trusting a cached place after 7 days (travel). The device
  language region is deliberately **not** a fallback: it names no state, which
  is the one thing it would have to decide, so with no server answer the
  prompt shows. The prompt (`ConsentGate`) waits for the first lookup (at most
  5 seconds) rather than flash for someone it turns out not to apply to.
  Outside production the endpoint accepts `?country=US&region=TX`, and
  `CICIRO_DEV_GEO=US-TX` (or `DE`) on the dev server pins the answer, so every
  case can be walked on a simulator without a VPN. IP geolocation is approximate: a VPN
  moves a person to the other side of the table.

  In an opt-out place with no recorded decision, analytics is on **unless the
  signed-in account's saved `analyticsEnabled` is off** (the account setting
  still follows a person across devices). A brand-new account created in such
  a place is created with it on (`adoptNewAccount` in `lib/settings.tsx`,
  called from `AuthScreen`); an existing account keeps whatever it saved, so
  an older US account that never opted in stays off until its owner flips the
  switch. Moving into an opt-in place with no decision shows the prompt and
  holds analytics off until it is answered; a recorded decision always wins
  over the regional default.

  **Not implemented, recommended for review** (see the PR for sources):
  Quebec (Law 25 reads as opt-in for profiling / non-essential tracking),
  South Korea, and Brazil (LGPD; the ANPD cookie guide allows legitimate
  interest for pure audience measurement, so it is not clearly opt-in).
  These currently fall in the "any other country" row and so get the prompt
  anyway; if the opt-out set is ever widened beyond the US, add them (and
  verify each one) first.

  `analyticsEnabled` in `AppSettings` (web `src/lib/settings.ts`, mobile
  `apps/mobile/lib/app-settings.ts`) is the signed-in account's *synced*
  copy of the analytics decision - a separate, secondary question from the
  device-local consent record above, and now defaults to `false` (a
  brand-new account implies no decision either way). Effective analytics is
  **device consent granted AND (not signed in OR the account's
  `analyticsEnabled` agrees)** - both sides must agree once someone is
  signed in, since the account setting can come from a *different* device
  that already decided. Deciding through the consent UI while signed in
  writes the decision through to `analyticsEnabled` too, so the two never
  contradict on the device that made the choice.

  This is first-party product analytics about how the product is used, not
  third-party ad tracking or cross-app data sharing, so it is outside the
  scope of Apple's App Tracking Transparency (no ATT prompt is needed or
  shown for it) - see "App Store privacy" below. That reasoning holds only
  for a first-party processor acting solely on Ciciro's instructions; it
  would stop applying the moment an ad-attribution SDK, or any sharing of an
  identifier with an ad network, is added.

  **Mobile implementation notes** (`apps/mobile/lib/analytics-client.ts`,
  `lib/consent.ts`, `lib/analytics-posthog-native.ts`): the real
  posthog-react-native client is never constructed at all until device
  consent is granted at least once (stronger than relying on an opt-out-by-
  default config flag, since there is then nothing to default), and starts
  opted out even then (`defaultOptIn: false`), with an explicit `optOut()`
  call on every construction before the one caller allowed to opt it back
  in (`setAnalyticsConsent`) does so. That explicit `optOut()` is a
  deliberate belt-and-suspenders step, not decoration: posthog-react-native
  has a known cold-start race where a *native-side* persisted opt-out/opt-in
  marker from a previous launch can override the JS config before JS
  corrects it (tracked upstream as `persistOptOut`, PostHog/posthog-js#4973);
  as of the pinned `posthog-react-native@^4.78.4` that option does not exist
  yet (confirmed by inspecting the published package - absent from both its
  type declarations and compiled bundle), so the app does not rely on
  `defaultOptIn` alone. Revisit once `persistOptOut` ships and the package
  is bumped. Withdrawal always calls `optOut()` before `reset()` (the
  required order) and keeps the adapter instance alive, just opted out, so
  changing your mind again in the same session needs no app restart.
  `sweepLegacyAnalyticsIdentity()` additionally resets any PostHog identity
  a device may already have from before this consent gate shipped (the
  prior behavior was opt-out and on by default) the first time a "Don't
  allow" decision is recorded.

  **Web implementation notes** (`src/lib/analytics-client.ts`,
  `lib/consent.ts`, `lib/consent-cookie.ts`, `lib/analytics-posthog-web.ts`):
  the consent record lives in a first-party `ciciro_consent` cookie
  (SameSite=Lax, ~180 days), read server-side in `src/app/layout.tsx` with
  `next/headers` and handed to `ConsentProvider.tsx` as `initialRecord`, so
  the banner never flashes on a reload where a decision already exists. The
  prompt is `CookieConsentBanner.tsx` (equal-weight Accept all/Reject
  all/Customize, shown on every page including signed-out marketing pages)
  and `CookiePreferencesDialog.tsx` (the per-category preference center,
  reopenable any time through `CookieSettingsButton.tsx` - the
  landing/features footers, the pricing and privacy pages, and a "Cookie
  settings" row in web Settings). `posthog-js` follows
  [PostHog's own documented consent posture](https://posthog.com/docs/privacy/data-collection):
  `posthog.init()` runs with `persistence: "memory"` and
  `opt_out_capturing_by_default: true` unless analytics is already granted
  at that exact moment (a returning, consented visitor), so nothing lands
  in a cookie or `localStorage` key before consent either way. Accepting
  calls `posthog.set_config({ persistence: "localStorage+cookie" })` then
  `opt_in_capturing()`; withdrawing calls `opt_out_capturing()` then
  `reset()` - never the other order, since `reset()` returns the SDK to its
  default consent state and would silently re-opt-out a capture that was
  never actually withdrawn if it ran first - then `clearPostHogWebStorage()`
  sweeps every `ph_*` cookie and `localStorage` key outright, including ones
  written by a returning visitor's browser from before this gating shipped.
  `navigator.globalPrivacyControl`, when sent, is honored as reject-all for
  analytics only while no explicit record exists yet for the device - it
  never overrides a choice already made. `cookieless_mode` (PostHog's
  server-hashed counting of non-consenting visitors) is deliberately not
  configured: it needs "Cookieless server hashing" turned on in the PostHog
  project dashboard first and silently does nothing without it - note that
  toggle explicitly if this is ever adopted, rather than assuming the mode
  works because the code passed the option.
- **Account deletion asks PostHog to forget the person.** The
  `posthog-delete-person` `PRE_DELETE_HOOK` (`src/lib/account/delete.ts`,
  see [docs/account-data.md](account-data.md)) is best-effort: it catches its
  own errors and never blocks deletion.
- **A/B tests, feature flags, session replay, and PostHog dashboards are out
  of scope** for this integration. Nothing here blocks adding them later;
  they just weren't built.

## Consent

A self-built cookie banner and preference center gate analytics - no
third-party consent platform, by owner preference. Web (`src/app/`) and
mobile build their own UI around the same contract; this section covers the
web implementation.

- **Categories**: `necessary` (the `ciciro_session` auth cookie and the
  `ciciro_consent` record itself - always on, no toggle, no consent needed),
  `functional` (device-local preferences: theme, focus mode, TTS prefs,
  chat width, scratchpad drafts, last-opened manuscript - on by default
  since they're the feature the author explicitly asked for, disclosed on
  the privacy page but never gated by the banner), `analytics` (PostHog -
  off until explicitly granted, everywhere, with no geo-gating), and a
  reserved `marketing` id with no consumer yet (left out of the UI and the
  stored record until something needs it).
- **The record**: `src/lib/consent.ts`'s `ConsentRecord`
  (`{ version, categories, decidedAt }`), stored in a first-party
  `ciciro_consent` cookie (`src/lib/consent-cookie.ts`: SameSite=Lax,
  ~180 days). `src/app/layout.tsx` reads it server-side with `next/headers`
  and hands it to `ConsentProvider.tsx` as `initialRecord`, so the banner
  never flashes on a reload where a decision already exists. Bump the
  exported `CONSENT_VERSION` whenever a category is added or its purpose
  changes; a stored record at any other version is treated as no decision
  yet, and the banner reappears.
- **UI**: `CookieConsentBanner.tsx` (equal-weight Accept all / Reject all /
  Customize, shown on every page - including signed-out marketing pages -
  until a current-version record exists; never a blocking modal) and
  `CookiePreferencesDialog.tsx` (the preference center: per-category
  toggles, reachable any time through `CookieSettingsButton.tsx` - the
  landing/features footers, the pricing and privacy pages, and the "Cookie
  settings" row in web Settings). No pre-ticked box, no cookie wall: the
  product works fully with analytics rejected.
- **Global Privacy Control**: `honorsGlobalPrivacyControl()` in
  `consent.ts` treats a `navigator.globalPrivacyControl` signal as
  reject-all for analytics only while no explicit record exists yet for
  this device - it never overrides a choice the author already made, and
  the banner still shows either way so they can make a real categorized
  choice.
- **Write-through with `analyticsEnabled`**: effective analytics is this
  device's consent AND (signed out OR the account's `analyticsEnabled`).
  `AnalyticsProvider.tsx` writes a signed-in author's consent decision
  through to `analyticsEnabled` the moment it actually changes (never on
  first load, which would let whatever this device decided before anyone
  signed in silently overwrite the account's setting), so the per-device
  and per-account settings never end up disagreeing. Server-side capture
  already respected `analyticsEnabled` (`analyticsOptedOut()` in
  `analytics-server.ts`, checked before `captureServerEvent` constructs an
  adapter at all) - the write-through above is what keeps that check
  correct now that consent, not this setting, decides whether to ask.
- **Gating posthog-js**: `analytics-client.ts` / `analytics-posthog-web.ts`
  follow [PostHog's own documented consent posture](https://posthog.com/docs/privacy/data-collection):
  `posthog.init()` runs with `persistence: "memory"` and
  `opt_out_capturing_by_default: true` unless analytics is already granted
  at that exact moment (a returning, consented visitor), so nothing lands
  in a cookie or `localStorage` key before consent either way. Accepting
  calls `posthog.set_config({ persistence: "localStorage+cookie" })` then
  `opt_in_capturing()`; withdrawing calls `opt_out_capturing()` then
  `reset()` - never the other order, since `reset()` returns the SDK to its
  default consent state and would silently re-opt-out a capture that was
  never actually withdrawn if it ran first - then `clearPostHogWebStorage()`
  sweeps every `ph_*` cookie and `localStorage` key outright, including ones
  written by a returning visitor's browser from before this gating shipped.
  `cookieless_mode` (PostHog's server-hashed counting of non-consenting
  visitors) is deliberately not configured: it needs "Cookieless server
  hashing" turned on in the PostHog project dashboard first and silently
  does nothing without it - note that dashboard toggle explicitly if this
  is ever adopted, rather than assuming the mode works because the code
  passed the option.

## Tracking plan

What each requested metric is answered with, and the PostHog insight type
that answers it. "Trends" and "Funnels" are PostHog's own insight types.

| Metric | Events | PostHog insight |
| --- | --- | --- |
| Conversion rate (visit -> account) | `screen_duration` (`landing`) -> `account_created` | Funnel: landing viewed -> signup screen -> `account_created` |
| Conversion rate (trial/free -> paid) | `paywall_viewed` -> `paywall_cta_clicked` -> `checkout_started` -> `subscription_purchased` | Funnel across those four steps, breakdown by `surface` |
| Click-through rate, any CTA | `cta_clicked` (`cta`, `surface`, `source?`) | Trends: count of `cta_clicked`, breakdown by `cta` or `surface` |
| Time spent per screen | `screen_duration` (`screen`, `durationMs`, `viewId`) | Sum `durationMs` grouped by `viewId` first (one total per visit, since pause/resume splits a visit into segments), then average or sum those per-visit totals, breakdown by `screen` |
| Time to first manuscript | `account_created` -> `project_created` (`isFirstProject: true`) | Funnel with "time to convert" between the two steps |
| Days to set up a reminder | `account_created` -> `reminder_enabled` | Funnel with "time to convert", bucketed in days |
| Feature usage, any feature | the feature-usage events below | Trends: count per event, breakdown by event name; or a Funnel from `account_created` to first use of a given feature, for adoption |
| Subscription lifecycle | `subscription_purchased` / `subscription_renewed` / `subscription_canceled` (`reason`) / `subscription_ended` (`plan`, `platform`, `interval?`) | Trends over time, breakdown by `plan`/`platform`, `subscription_canceled` also by `reason`; a Lifecycle insight for net new/churned |
| Retention | any event, typically `screen_duration` or `chat_message_sent` as the "active" signal | Retention insight, cohorted by `account_created` week |
| Impact of a change on usability/retention/subscriptions | any of the above, filtered or broken down by the `release` super property | Trends/Funnel/Retention with a `release` breakdown or filter, comparing before/after a `CICIRO_RELEASE` value |

`cta_clicked` fires on every primary call to action not already covered by a
more specific event (a feature event, or `paywall_cta_clicked`): the landing
page (`src/components/landing/Landing.tsx`, through the `TrackedLink`
wrapper at `src/components/TrackedLink.tsx`), the pricing page's plan
buttons (`src/app/pricing/PricingPlans.tsx`, alongside
`paywall_cta_clicked` on the Pro button so both the general click-through
metric and the paywall funnel see it), and in-app upgrade nudges outside the
paywall (`AccountBar.tsx`'s and `SettingsBilling.tsx`'s "Upgrade" links on
web; `ChatErrorNotice.tsx`'s "See Pro" and `settings.tsx`'s "Upgrade" action
on mobile) and the mobile library's "New manuscript" menu item. `cta` is a
stable id per button; the same conceptual button repeated at a different
page position (e.g. the landing page's nav vs. hero "Get early access") gets
a distinct id so click-through breaks down by placement, while the same
upgrade nudge reused across platforms (`upgrade_to_pro`) keeps one id, since
`platform` already distinguishes them.

Email click-through uses the same event with `source: "email"`: every
template's primary link in `src/lib/email/templates.ts` is tagged by
`withSource` with `?src=email&cta=<category>`, and `AnalyticsProvider.tsx`
records `cta_clicked` (surface = the page the link opened, `cta` = the
template's `category`) when a page loads with that pair, then strips it from
the URL - the same one-time-query-param pattern it already uses for a social
sign-in redirect's `auth_event`. The unsubscribe and preference links
(`EmailContent.unsubscribe`, attached by `sendMarketingEmail`) are never
tagged and keep working exactly as before.

## Feature-usage event inventory

Every event, what fires it, and on which platform(s). "Both" means the call
site exists on web and mobile, firing the same event name with the same
property shape.

| Event | Fires on | Platform |
| --- | --- | --- |
| `project_created` (`kind`, `isFirstProject`) | Creating a new (non-imported) manuscript. `isFirstProject` is computed server-side in `createProject` (a count of the account's existing projects taken atomically with the create), never client-side, so neither platform races its own project list | Both |
| `chat_message_sent` | Sending a typed chat message (not quick actions, not resumed turns) | Both |
| `quick_action_used` (`action`, `kind`) | Running a quick-action chip. Web's `action` is the shared `src/lib/prompts.ts` action id; mobile's is its own smaller `continue`/`rewrite`/`describe` set - the two are not the same vocabulary | Both |
| `selection_action_used` (`action`, `target`) | Pressing Comment, Rewrite, Describe, Expand or Fix in the menu over highlighted text. `target` is `word` or `passage`; never the text | Both |
| `synonym_used` (`more`) | Swapping a synonym in for the highlighted word; `more` when it came from the web's "N more" list, or was past the first few chips on the phone's strip | Both |
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
| `deadline_saved` (`created`, `daysAhead`) | A manuscript's deadline is saved: `created` is false for an edit, `daysAhead` is whole days from today to the due date | Both (the web's Deadline drawer in the More menu, the phone's Deadline screen); no title or text |
| `deadline_removed` | A manuscript's deadline is removed (on the web, once its Undo has lapsed and the server has deleted it) | Both |
| `deadline_met` | The manuscript's words reach its deadline target, once per target on a device (the same guard as the goal-met haptic; the web keeps it in `localStorage`) | Both |
| `writing_exercise_started` (`exercise`) | Begin is tapped on one of the guided writing exercises | Mobile only; no author text, the id is one of `EXERCISE_IDS` (`observe_react_narrate`, `pour_it_out`, `one_true_sentence`, `terrible_first_draft`, `noun_list`) |
| `writing_exercise_completed` (`exercise`, `durationMinutes`) | The exercise's last part is finished (not on leaving early) | Mobile only; whole minutes from Begin, same ids as above |
| `review_prompt_requested` (`trigger`: `export` or `exercise`) | The native store-review prompt is asked for, once per device, after the first manuscript export or finished writing exercise | Mobile only; the OS decides whether it appears |
| `listening_engine_chosen` (`engine`: `system` or `natural`) | The writer picks the voice engine on the Listening settings screen | Mobile only |
| `natural_voice_chosen` (`voice`) | The writer picks a natural voice; `voice` is a Kokoro voice id from `NATURAL_VOICES` | Mobile only; a fixed catalog id, no text |
| `natural_voice_sample_played` (`voice`) | A bundled voice sample is played, before or after the download | Mobile only; same ids |
| `natural_voice_download_started` (`resumed`, `cellular`) | The natural-voice download starts or picks up again; `cellular` is true when the writer chose to download on mobile data | Mobile only |
| `natural_voice_download_completed` (`seconds`, `resumed`) | The download finished and every file is in place and checked | Mobile only; whole seconds of the last stretch |
| `natural_voice_download_failed` (`reason`) | The download or install stopped in an error: `network`, `storage`, `integrity`, `install` or `unknown` | Mobile only |
| `natural_voice_download_canceled` | The writer cancelled a download and its partial files were removed | Mobile only |
| `natural_voice_deleted` | The writer removed the downloaded model to free space | Mobile only |
| `natural_voice_read_finished` (`outcome`, `firstAudioMs`, `rtf`, `underruns`, `synthesized`, `cached`) | A natural-voice read ended, whether it played to the end (`completed`), was stopped or paused partway (`stopped`) or handed over to the system voice (`fallback`): ms to the first sound, time spent making speech over its length (under 1 keeps up; both null for a read stopped before anything was made or heard), pauses waiting for the next sentence, sentences made and sentences answered from the saved audio | Mobile only; numbers, no text. The only real-phone performance data we collect |
| `natural_voice_fallback` (`reason`, `why`) | The natural voice gave up partway and the system voice carried on | Mobile only; `reason` is `failed` or `too-slow`, `why` says which check fired |
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
| `state_review_run` | A What changed review of the open chapter completes | Web only |
| `knowledge_fact_kept` | Keeping a who-knows-what proposal from What changed | Web only |
| `knowledge_fact_added` | Adding a fact on the Knowledge screen | Both. Adding from a character file's **Who knows what** list (web) does not fire this |
| `knowledge_fact_retired` | Retiring a fact on the Knowledge screen | Both. Retiring from a character file's **Who knows what** list (web) does not fire this |
| `knowledge_fact_replaced` | **Changes here** on the Knowledge screen: a character's view changes at the chapter in view | Both |
| `knowledge_scrubber_used` | First move of the Knowledge screen's chapter scrubber in a visit | Both |
| `knowledge_fact_added_via_chat` | Ciciro recording a who-knows-what fact the author asked for in chat (`record_knowledge`) | Server, for the project's owner |
| `canvas_card_created` | Adding a card on the planning canvas | Web only |
| `canvas_generated` (`mode`: `fill` \| `outline` \| `options`) | Accepting a Fill, Options, or Generate full outline result onto the canvas | Web only |
| `notes_scan_read` (`pages`, `outcome`: `ok` \| `partial` \| `unreadable` \| `offline` \| `limit` \| `error`) | Photos of handwritten notes finish being read (or fail to): `partial` means some words or a page were doubtful, `unreadable` that no writing was found, `offline` and `limit` (this month's AI allowance) that the read could not start | Mobile only; counts only, never the notes or a photo |
| `notes_scan_added` (`destination`: `bible_file` \| `bible_new` \| `canvas`, `pages`, `edited`) | The reviewed text is added to a story bible file, a new character / plot-line file, or the canvas; `edited` is whether the writer changed the recognized text first | Mobile only; no text |
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

`subscription_canceled` and `subscription_ended` are two distinct moments.
`subscription_canceled` is, on every platform, the moment a subscription
stops being set to renew: RevenueCat `CANCELLATION`; Stripe
`customer.subscription.updated` newly scheduling an end (via
`newlyScheduledCancellation` in `src/lib/billing/stripe.ts`, the same moment
the cancellation email fires); or Stripe `customer.subscription.deleted` when
no end was scheduled beforehand, in which case it fires right before
`subscription_ended`, at the same instant. `subscription_ended` fires when
access is actually gone (RevenueCat `EXPIRATION`; Stripe
`customer.subscription.deleted`). `subscription_canceled`'s `reason` says
why:

- `voluntary`: the subscriber turned off auto-renew (Stripe's scheduled
  cancellation; RevenueCat `cancel_reason` `UNSUBSCRIBE`).
- `billing_failure`: payment retries ran out (Stripe `cancellation_details.reason`
  `payment_failed`; RevenueCat `BILLING_ERROR`).
- `immediate`: canceled to end at once, not at period end (Stripe
  `cancellation_requested` on an unscheduled deletion). Stores never produce
  it: there `CANCELLATION` and `EXPIRATION` are always separate events.
- `refund`: a refund or dispute ended it (Ciciro's own `charge_refunded` /
  `charge_disputed` cancellation comment, Stripe `payment_disputed`;
  RevenueCat `CUSTOMER_SUPPORT`).
- `other`: anything else (e.g. RevenueCat `DEVELOPER_INITIATED` or
  `PRICE_INCREASE`, a Stripe deletion with no stated reason).

## Known gaps (documented, not fixed in this pass)

- **A widget glance has no event.** `apps/mobile/lib/writing-widget.ts`'s
  deep link is byte-identical to any other navigation to the same route, so
  "opened from the widget" is not distinguishable from a normal screen open
  today (email clicks are, via `cta_clicked`'s `source: "email"`; see
  above). Adding one needs a product decision to append a tracking param
  (e.g. `?src=widget`), not just an analytics call.
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

1. Create a PostHog project. Ciciro defaults to PostHog EU Cloud (Frankfurt)
   for GDPR posture; pick data residency up front, since it cannot be changed
   later without migrating to a new project. Point at US cloud or a
   self-hosted instance instead via the host env vars in
   [hosting.md#analytics](hosting.md#analytics).
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
7. Cookieless counting of visitors who reject analytics (PostHog's
   `cookieless_mode`) is not configured - see "Opt-in consent" above.
   Adopting it later needs "Cookieless server hashing" turned on in the
   PostHog project settings first; the code alone does nothing without that
   toggle.

## App Store privacy label notes

For the App Store "App Privacy" (nutrition label) questionnaire:

- **Data collected**: "User ID" (the internal account id) and "Product
  Interaction" (the typed event/screen data in the catalog above), both for
  purpose "Analytics". No "Name", "Email Address", or "User Content"
  category applies to this integration, since none of those are ever sent.
- **Linked to the user**: Yes (the PostHog person is identified by the
  account's internal id while signed in).
- **Used for tracking**: No. "Tracking" in Apple's definition is linking
  data with third-party data for ads or sharing with a data broker; PostHog
  here is a data processor acting solely on Ciciro's instructions, which
  does neither, so this does not require an ATT prompt and should be marked
  "not used for tracking". That holds only while PostHog's terms keep it a
  processor and nothing here adds an ad SDK or shares an identifier with an
  ad network - if either ever changes, this note and the ATT exemption both
  need re-checking.
- The privacy policy should mention PostHog as a sub-processor for product
  analytics, alongside Stripe/RevenueCat/Resend/Anthropic if they are
  already listed there.

**Google Play Data safety form** (mobile): declare data types "App
activity / App interactions" and "User ID" (both the internal account id),
purpose "Analytics", and mark "Not shared with third parties" - PostHog
qualifies for Google's "service provider" carve-out (processes solely on
Ciciro's instruction, under Ciciro's privacy policy) as long as the signed
PostHog DPA (not just its general cloud terms) keeps it from reusing the
data for its own purposes. The owner should confirm that against the
actual signed agreement, not assume it from the public terms.
