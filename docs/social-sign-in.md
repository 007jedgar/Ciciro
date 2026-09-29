# Sign in with Apple and Google

Ciciro accounts can sign in with Apple or Google alongside email and password,
on the web and in the app. Every path ends in the same `ciciro_session`
session as a password sign-in, so nothing past sign-in knows the difference.

Each provider's button only appears when its configuration is complete (see
`socialAvailability` in `src/lib/auth/social-config.ts` and
`GET /api/auth/providers`). With nothing set, the login and signup screens show
email and password only.

## How it works

| Where | Apple | Google |
|---|---|---|
| Web | Browser flow, Apple posts back (`form_post`) | Browser flow with PKCE |
| iOS app | Native Sign in with Apple sheet | Browser flow in the system browser |
| Android app | Browser flow in a Custom Tab | Browser flow in a Custom Tab |

- **Browser flow** (`src/lib/auth/social-sign-in.ts`):
  `GET /api/auth/oauth/:provider/start` stores `state`, `nonce` and a PKCE
  verifier in a short-lived httpOnly cookie (`ciciro_oauth`) and redirects to
  the provider. The callback checks `state` against the cookie, verifies the ID
  token, signs in, and redirects to `next` with a session cookie.
- **The app's browser flow** adds `?client=native&challenge=<S256>`. The
  callback then redirects to `ciciro://oauth?code=...` instead of setting a
  cookie, and the app redeems that one-time code with its verifier at
  `POST /api/auth/handoff` (`AuthHandoff` rows, single use, five minutes).
  No session token ever travels in a URL.
- **iOS Apple sheet**: the app hands Apple the SHA-256 of a raw nonce, then
  posts the ID token, the raw nonce, the authorization code, and the name to
  `POST /api/auth/apple/native`.

Every ID token is verified against the provider's published keys (JWKS) for
signature, issuer, audience, expiry, and nonce (`src/lib/auth/oidc.ts`). There
is no nonce-less path.

### Accounts and linking

`signInWithIdentity` in `src/lib/auth/identity.ts`:

1. A known provider identity (`Identity`, unique on provider + `sub`) signs
   into its account, even after the email on it changes.
2. Otherwise a **verified** email matching an account links to it, and marks
   its email verified. If that account was an unverified password account, the
   link is a takeover (see the follow-up below). Apple's private-relay
   addresses (`@privaterelay.appleid.com`) are ordinary emails.
3. Otherwise a verified email creates an account with no password
   (`passwordHash` is `""`, which never verifies) and `emailVerifiedAt` set.
4. An unverified email never links or creates anything.

Apple sends the person's name only on the first authorization. The app and the
web callback forward it, and it only ever fills an empty name.

Apple sign-ins also exchange the authorization code for a refresh token, stored
on the `Identity` with the client_id it was issued to.

### Account deletion

App Store guideline 5.1.1(v) requires revoking Sign in with Apple when the
account is deleted. `APPLE_REVOKE_HOOK` in `src/lib/account/delete.ts` runs
`revokeAppleTokens(userId)` (`src/lib/auth/apple-revoke.ts`) as a pre-delete
hook, before the purge removes the `Identity` rows holding the tokens. It calls
Apple's `/auth/revoke` with each token's own client_id; if Apple refuses any,
or the Apple key env vars are gone, deletion stops with the account intact so
the person can retry (docs/account-data.md).

An account without a password (`PublicUser.hasPassword` is false) confirms
deletion by typing `DELETE` instead of a password, on the web dialog and the
phone's screen.

### Follow-ups

- **Fresh provider sign-in as deletion proof**: a password-less account types
  `DELETE`. Accepting a freshly verified Apple / Google ID token in
  `verifyDeletionProof` would be stronger proof than a session plus a typed word.
- **Password signups are not email-verified yet** (that belongs to the email
  templates task). `User.emailVerifiedAt` is set only by a social sign-in, so
  every password account starts unverified. When a provider-verified Apple or
  Google sign-in matches an unverified password account, the provider-verified
  owner takes it over: the identity is linked, `passwordHash` is cleared to
  `NO_PASSWORD`, every session and pending hand-off for the user is deleted,
  and `emailVerifiedAt` is set. That closes pre-hijacking, where someone
  registers another person's address with a password before its owner first
  uses Apple or Google. The person sees a one-time notice naming the provider
  (`?password_removed=<provider>` on the web landing URL, the same parameter on
  `ciciro://oauth`, and `takeover` in the native Apple response). Later provider
  sign-ins into a verified account link normally and revoke nothing. Once
  password signups verify their email, set `emailVerifiedAt` there too.
- **Emailing Apple relay addresses**: register the sending domain under
  "Sign in with Apple for Email Communication" in the Apple Developer portal,
  or mail to `@privaterelay.appleid.com` bounces.

## Configuration

| Variable | Needed for | Value |
|---|---|---|
| `APPLE_SERVICES_ID` | Apple on the web and Android | The Services ID, e.g. `app.ciciro.web` |
| `APPLE_BUNDLE_ID` | Apple in the iOS app | `app.ciciro.mobile` (`ios.bundleIdentifier` in `apps/mobile/app.json`) |
| `APPLE_TEAM_ID` | All Apple | 10-character Team ID |
| `APPLE_KEY_ID` | All Apple | 10-character Key ID of the Sign in with Apple key |
| `APPLE_PRIVATE_KEY` | All Apple | The `.p8` file's contents. A one-line value with literal `\n` works too. |
| `GOOGLE_CLIENT_ID` | All Google | The **Web application** OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | All Google | That client's secret |
| `CICIRO_PUBLIC_URL` | Optional | The public origin, e.g. `https://ciciro.app`. Set it when a proxy in front of Ciciro makes requests look like `http://` or another host: the callback URL sent to Apple and Google is built from it and must match the registered one exactly. Defaults to the request's origin. |

The app needs no provider configuration of its own: it asks the server which
buttons to show, and Google runs through the server's web client.

On Cloudflare, set them as secrets (`APPLE_PRIVATE_KEY` from the file keeps its
newlines):

```bash
npx wrangler secret put APPLE_SERVICES_ID
npx wrangler secret put APPLE_BUNDLE_ID
npx wrangler secret put APPLE_TEAM_ID
npx wrangler secret put APPLE_KEY_ID
npx wrangler secret put APPLE_PRIVATE_KEY < AuthKey_XXXXXXXXXX.p8
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Production D1 needs the `Identity` and `AuthHandoff` tables and the
`User.emailVerifiedAt` column first:

```bash
npx wrangler d1 execute ciciro --remote --file=prisma/d1-social-sign-in.sql
npx wrangler d1 execute ciciro --remote --file=prisma/d1-email-verified.sql
```

## Apple Developer setup

Needs a paid Apple Developer Program membership. At
[developer.apple.com/account](https://developer.apple.com/account), under
**Certificates, Identifiers & Profiles**:

1. **App ID.** Identifiers, open `app.ciciro.mobile` (create it as an App ID if
   it does not exist). Tick **Sign in with Apple**, leave it as a primary App
   ID, and save. The app's `ios.usesAppleSignIn` adds the entitlement; rebuild
   the app after this.
2. **Services ID** (the web client). Identifiers, **+**, **Services IDs**.
   Description `Ciciro Web`, identifier `app.ciciro.web`. Register it, open it,
   tick **Sign in with Apple**, then **Configure**:
   - Primary App ID: `app.ciciro.mobile`
   - Domains and Subdomains: `ciciro.app` (your host, no scheme)
   - Return URLs: `https://ciciro.app/api/auth/oauth/apple/callback`

   Save. This is `APPLE_SERVICES_ID`.
3. **Key.** Keys, **+**. Name it `Ciciro Sign in with Apple`, tick **Sign in
   with Apple**, **Configure**, choose `app.ciciro.mobile`, save, register.
   Download the `.p8` (Apple only lets you download it once): its contents are
   `APPLE_PRIVATE_KEY`, and the Key ID shown is `APPLE_KEY_ID`.
4. **Team ID.** Top right of the Membership details page: `APPLE_TEAM_ID`.

Apple refuses `localhost` and plain-HTTP return URLs, so test Apple on the web
against a deployed or tunneled HTTPS origin whose callback is in step 2's list.
The iOS sheet works against any server, local included, since it only posts a
token.

## Google Cloud setup

At [console.cloud.google.com](https://console.cloud.google.com/), in a project
for Ciciro, open **APIs & Services** then **Google Auth Platform**:

1. **Branding.** App name `Ciciro`, a support email, the logo, the home page
   and privacy policy (`https://ciciro.app/privacy`), and `ciciro.app` under
   authorized domains.
2. **Audience.** User type **External**. While the app is in *Testing*, only
   the listed test users can sign in; **Publish app** when ready. The scopes
   Ciciro asks for (`openid`, `email`, `profile`) need no Google review.
3. **Clients**, **Create client**, type **Web application**, name
   `Ciciro web`. Under **Authorized redirect URIs** add:
   - `https://ciciro.app/api/auth/oauth/google/callback`
   - `http://localhost:3000/api/auth/oauth/google/callback` for local development

   Create it. The client ID is `GOOGLE_CLIENT_ID` and its secret is
   `GOOGLE_CLIENT_SECRET`.

The app uses this same web client through the system browser, so there are no
iOS or Android OAuth clients to create.

## Testing without real credentials

The tests mint ID tokens with locally generated keys (`test/helpers/fake-idp.ts`)
and stub the providers' token endpoints, so `npm test` covers verification,
linking, both browser flows, the hand-off, and the iOS sheet path without
network access or real credentials.
