# Mobile release: EAS Build, Update, Workflows and push

The phone app (`apps/mobile`, EAS project `@corki/ciciro`,
`fec740f0-4e6e-4c53-8ac5-bc6d448fd1d8`) builds, updates and sends push
notifications through Expo Application Services. Launch is iOS first; the
Android profiles exist, but no automatic workflow builds Android yet.

Everything below that changes EAS, Apple or Cloudflare state (creating
variables, credentials, builds, updates) is run by a person, once, from
`apps/mobile`. The repo only holds configuration.

## Build profiles and channels

`apps/mobile/eas.json`:

| Profile | What it makes | Distribution | EAS environment | Update channel |
|---|---|---|---|---|
| `development` | dev client (`expo-dev-client`) for registered devices | internal | `development` | `development` |
| `development-simulator` | the same, for the iOS simulator | internal | `development` | `development` |
| `preview` | a release build for testers' registered devices (Android: an APK) | internal | `preview` | `preview` |
| `production` | the store build | store | `production` | `production` |

- Build numbers live on EAS (`appVersionSource: remote`) and `autoIncrement`
  bumps them on every preview and production build. The marketing version is
  `expo.version` in `app.json`; bump it by hand for a store release.
- `preview` and `production` set `CICIRO_RELEASE=1`, which makes
  `app.config.ts` refuse to build a bundle whose `EXPO_PUBLIC_API_URL` is
  missing, not https, or local, or that has the development-only
  `EXPO_PUBLIC_BILLING_PREVIEW` set. Without it, a build whose EAS variables
  were never created would silently talk to `http://localhost:3000`.
- A build's channel is fixed when it is built. An update published to a
  channel reaches only builds of that channel with the same runtime version.

## Over-the-air updates

`expo-updates` is installed and `app.json` sets:

- `runtimeVersion: { policy: "fingerprint" }`: the runtime version is a hash of
  everything native (dependencies with native code, config plugins, `app.json`
  native fields, the `patches/` for the native editor, the widget). Any change
  there makes a new runtime version, so an update can never reach a binary
  whose native code it does not match. Check what the current commit hashes to
  with `npx expo-updates fingerprint:generate --platform ios`.
- `updates.url` on `u.expo.dev`, `checkAutomatically: "ON_LOAD"`,
  `fallbackToCacheTimeout: 0`: every cold launch checks for an update without
  waiting for it, and what it downloads runs on the next cold launch.

In the app, `components/UpdateSync.tsx` (`lib/app-updates.ts`) also checks at
most hourly when the app returns to the foreground, since a writing session
can go days without a relaunch. It downloads in the background and never calls
`reloadAsync`: the new JavaScript runs the next time the app starts, never
under someone who is writing. Development builds skip all of this
(`Updates.isEnabled` is false).

Adding `expo-updates` is a native change: rebuild the dev client
(`npx expo run:ios`, or the Development build workflow) before running this
branch on a device.

To ship a hotfix by hand instead of through the workflow:

```bash
cd apps/mobile
CICIRO_RELEASE=1 eas update --channel production --environment production --platform ios --message "Fix ..."
```

Roll back with `eas update:rollback`, or republish the previous update group
from the dashboard. `--rollout-percentage` (or the workflow's
`rollout_percentage`) stages an update to part of the audience first.

## Workflows

EAS Workflows live in `apps/mobile/.eas/workflows/` (next to `eas.json`) and
run on EAS, not GitHub Actions. They trigger from GitHub once the repository
is linked (see [One-time setup](#one-time-setup)); any of them also runs by
hand with `eas workflow:run .eas/workflows/<file>.yml`.

| File | Trigger | What it does |
|---|---|---|
| `deploy-production.yml` | push to `main` touching `apps/mobile/**` | Fingerprints the app. If a production iOS build with that fingerprint exists, publishes the commit as an update to the `production` channel. If not (native code changed), makes a new production iOS build instead. |
| `build-production.yml` | a `mobile-v*` tag, or by hand (`-F platform=ios\|android\|all`) | A store build. Submission to the App Store is a separate step for now. |
| `preview-build.yml` | a PR labeled `mobile-preview` (and every later push to it), or by hand | Fingerprints the PR. Repacks an existing preview build with the PR's JavaScript when the native layer is unchanged (minutes, not a full build), builds otherwise, and comments the install links on the PR. |
| `development-build.yml` | by hand (`-F target=simulator\|device`) | A dev client, for when native code changes. |

Merging mobile JavaScript to `main` therefore reaches production users on
their next launch. Test risky changes on a preview build first.

Validate a workflow file after editing it:

```bash
cd apps/mobile
eas workflow:validate .eas/workflows/deploy-production.yml
```

(eas-cli 24.8 crashes with `Cannot read properties of undefined (reading
'const')` on every file, from a job type the live schema added. Until a fixed
CLI ships, save `https://api.expo.dev/v2/workflows/schema` to a file, add
`"type": {"not": {}}` to the `properties` of the one entry in
`data.properties.jobs.additionalProperties.anyOf` that has no `type`, and point
`EXPO_TESTING_WORKFLOW_SCHEMA_PATH` at it.)

## Environment variables

The gitignored `.env` never uploads to EAS, so builds, updates and workflow
jobs read EAS environment variables. Anything `EXPO_PUBLIC_` is compiled into
the app and readable by anyone who installs it: only values that are safe to
publish go there, and never with `secret` visibility (secret values are not
available to `eas update` or to local config resolution).

| Variable | development | preview | production | Visibility | Notes |
|---|---|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://ciciro.app` | `https://ciciro.app` | `https://ciciro.app` | plaintext | Required for preview and production (`app.config.ts` enforces it). Locally, `.env` points it at your own server. |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat iOS public key (`appl_...`) | same | same | sensitive | Public SDK key, shipped in the app; sensitive only keeps it out of build logs. Without it the app sells nothing. See [billing](billing.md#revenuecat). |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | RevenueCat Android public key (`goog_...`) | same | same | sensitive | Android launch. |
| `EXPO_PUBLIC_BILLING_PREVIEW` | optional, `1` | never | never | plaintext | Sample-price paywall in development only; release builds refuse it. |
| `GOOGLE_SERVICES_JSON` | file | file | file | secret (file) | Android push (FCM), at Android launch. `app.config.ts` passes it to `android.googleServicesFile`. |

Create them once:

```bash
cd apps/mobile
eas env:set --name EXPO_PUBLIC_API_URL --value https://ciciro.app \
  --environment development --environment preview --environment production \
  --visibility plaintext --non-interactive
eas env:set --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY --value <appl_ key> \
  --environment development --environment preview --environment production \
  --visibility sensitive --non-interactive
# Android launch:
eas env:set --name EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY --value <goog_ key> \
  --environment development --environment preview --environment production \
  --visibility sensitive --non-interactive
eas env:set --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json \
  --environment development --environment preview --environment production \
  --visibility secret --non-interactive
```

Check with `eas env:list --environment production`, and pull the development
set into a local `.env` with `eas env:pull --environment development`.

Signing credentials (distribution certificate, provisioning profiles for the
app and the widget extension, the APNs key) are not environment variables:
EAS stores them (`eas credentials`). The only secret the server side of push
needs, `EXPO_ACCESS_TOKEN`, is a Cloudflare Worker secret (see below).

## Push notifications

What the app notifies about today is all local and scheduled on the phone:
writing reminders (`lib/writing-reminder-notifications.ts`, the next
occurrence of each reminder) and the end of a writing sprint
(`app/project/[id]/sprint.tsx`). Those work offline and stay local. The server
sends no notifications yet; push is the plumbing for when it does.

- **Registration.** `components/PushRegistrationSync.tsx`
  (`lib/push-registration.ts`) registers the phone's Expo push token with
  `POST /api/push/tokens` while someone is signed in and has allowed
  notifications. It never asks for permission itself: the writing-reminder
  screens do, and registration follows the answer (granted registers, turned
  off in Settings unregisters with `DELETE /api/push/tokens`). It re-checks on
  every return to the foreground and when the platform rotates the token.
- **Storage.** `PushToken` rows (`src/lib/push/tokens.ts`) belong to the
  sign-in that registered them: signing out, or the session expiring, deletes
  them, so a shared phone never receives another account's notifications. An
  account keeps its 20 most recent phones. Account deletion and the data
  export cover both push tables (the export leaves out the token itself).
- **Sending.** `sendPushToUser(userId, { title, body, data })` in
  `src/lib/push/send.ts` posts to the Expo Push API in batches of 100, retries
  429s and 5xx with backoff, and never throws. An ok ticket is stored as a
  `PushTicket`; `checkPushReceipts` reads receipts 15 minutes later (every
  send runs it first), logs delivery errors, and deletes the token when Apple
  or Google answers `DeviceNotRegistered`, at either the ticket or the receipt.
  A new notification type is a call to `sendPushToUser` with a `data.href` the
  app can open, plus an Android `channelId` the app creates.

Production D1 needs the tables before the build that ships this is deployed:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-push-tokens.sql
```

To test on the iOS simulator without APNs, drop a payload on the booted
simulator (the notification shows even with no server):

```bash
xcrun simctl push booted app.ciciro.mobile - <<'JSON'
{"aps": {"alert": {"title": "Ciciro", "body": "Time to write"}, "sound": "default"}}
JSON
```

To send a real one to a device, take its token from the `PushToken` row (or
the app's log) and post it to Expo:

```bash
curl -H "Content-Type: application/json" -X POST https://exp.host/--/api/v2/push/send \
  -d '{"to": "ExponentPushToken[...]", "title": "Ciciro", "body": "Test"}'
```

## One-time setup

Each of these changes remote state, so a person runs them once:

1. **iOS credentials, including push.** `eas credentials -p ios`, production
   profile: let EAS create the distribution certificate and the provisioning
   profiles (`app.ciciro.mobile` and the widget's `app.ciciro.mobile.widgets`),
   then **Push Notifications: Manage your Apple Push Notifications Key** to
   create or upload an APNs key. Workflows run non-interactively, so these must
   exist before the first workflow build (a first interactive
   `eas build -p ios --profile production` also sets them up).
2. **Testers' devices** for internal builds: `eas device:create`, then rebuild
   the preview or development profile so the ad hoc profile includes them.
3. **Environment variables**: the `eas env:set` commands above.
4. **GitHub**: in the EAS dashboard, Project settings > GitHub, connect
   `007jedgar/Ciciro` and set the base directory to `apps/mobile`, so pushes,
   tags and labels trigger the workflows. Create the `mobile-preview` label on
   the repository.
5. **D1**: `wrangler d1 execute ciciro --remote --file=prisma/d1-push-tokens.sql`
   (before merging, since `main` fails its build while D1 is behind).
6. **Optional, recommended once push is used**: turn on enhanced push security
   (expo.dev > Account settings > Access tokens), create a robot access token,
   and `wrangler secret put EXPO_ACCESS_TOKEN`. The sender adds it as a bearer
   token when it is set.
7. **Android, at launch**: `eas credentials -p android` to generate the
   keystore and upload the FCM V1 service account key, then the Android
   variables above, then add the Android jobs to `deploy-production.yml`.
