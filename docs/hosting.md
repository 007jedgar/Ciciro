# Hosting Ciciro

Ciciro started as a local-first, single-author app (Next.js + SQLite on disk).
"Ciciro-hosted" turns it into a multi-tenant service. This document covers the
two supported deployment paths and the pieces they share: authentication, a
health probe, a serverless-friendly database, and the Durable-Objects-backed
run coordinator.

## What "hosted" adds

- **Accounts + sessions** (`src/lib/auth/**`). Email + password with scrypt
  hashing, plus Sign in with Apple and Google; opaque session cookies (only the
  token hash is stored). See [Auth](#authentication).
- **Auth enforcement** via `src/middleware.ts`, opt-in with
  `CICIRO_REQUIRE_AUTH=true`. Local development stays open by default.
- **Owner-scoped projects**. `Project.userId` links a manuscript to its owner;
  listing and project access are filtered per user.
- **Health probe** at `GET /api/health` for load balancers and uptime checks.
  It returns 503 `degraded` unless the database answers, every Prisma model
  reads with every column (so a missed `prisma/d1-*.sql` upgrade shows up).
  `anthropic` reports whether `ANTHROPIC_API_KEY` is set without failing the
  probe. `.github/workflows/uptime.yml` checks ciciro.app every 5 minutes,
  also requires `anthropic: true`, and opens an `outage` issue when either
  fails, closing it on recovery.
- **Fleet-wide run serialization** through a Cloudflare Durable Object
  (`src/worker/run-do.ts`) fronting the existing database lease. Falls back to
  an in-process coordinator when no DO binding is present.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | for the assistant | The editor/drafter models. The manuscript editor works without it. |
| `DATABASE_URL` | yes | See [Database](#database). SQLite-on-disk is local-only. |
| `CICIRO_REQUIRE_AUTH` | hosted | `true` enables the auth gate in middleware and API routes. |
| `CICIRO_EDITOR_MODEL` / `CICIRO_DRAFTER_MODEL` / `CICIRO_DRAFTER_FAST_MODEL` | optional | Model overrides (see README). |
| `CICIRO_STANDALONE` | build-time | `true` makes `next build` emit a standalone server (Docker path). |
| `RESEND_API_KEY` | optional | Transactional email (see [Email](#email)). Unset logs instead of sending (at error level when `CICIRO_REQUIRE_AUTH` is set). |
| `EMAIL_FROM` | for email | `"Name <address>"` the send comes from. Required once `RESEND_API_KEY` is set. |
| `EMAIL_REPLY_TO` | optional | Reply-to address; overridable per send. |
| `APPLE_*`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Sign in with Apple / Google. See [social sign-in](social-sign-in.md#configuration). |
| `CICIRO_PUBLIC_URL` | Path A | The public origin, e.g. `https://ciciro.app`, for the Apple / Google callbacks and links in emails. Unset uses the request's origin, which is safe on Workers but lets a container that trusts a forwarded Host send reset links to someone else's site. |

Never commit `.env`; set secrets through your platform (Cloudflare
`wrangler secret put`, or container env).

## Path A — Node container (Docker)

A self-contained Node server using Next.js standalone output. Best when you want
a normal Postgres/libSQL database and a long-lived process.

```bash
docker build -t ciciro .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e DATABASE_URL="postgresql://..." \
  -e CICIRO_REQUIRE_AUTH=true \
  ciciro
```

The image builds with `CICIRO_STANDALONE=true`, copies the standalone bundle,
static assets, and the Prisma engine, and ships a `HEALTHCHECK` that hits
`/api/health`. Run database migrations (`prisma migrate deploy`) against your
hosted database as part of your release step.

## Path B — Cloudflare Workers (OpenNext + Durable Objects)

Runs the Next.js app on Cloudflare via [`@opennextjs/cloudflare`], with the
editor-run Durable Object deployed alongside it. This is the path that uses
`EditorRunDO` as the fleet-wide single-writer lock.

```bash
npm run cf:build     # next build -> .open-next/worker.js
npm run cf:preview   # local preview with the workerd runtime
npm run cf:deploy    # wrangler deploy
```

Workers Builds should use `npm run cf:build` (or keep `npm run build`, which
detects `WORKERS_CI=1` and runs the OpenNext adapter). A plain `next build`
does not create `.open-next/assets`, so `wrangler versions upload` fails.

Key files:

- `wrangler.jsonc` — worker name, `nodejs_compat`, the static-assets binding,
  the `EDITOR_RUN_DO` Durable Object binding, and the `v1` migration that
  creates the `EditorRunDO` SQLite-backed class.
- `open-next.config.ts` — the OpenNext Cloudflare adapter config.
- `src/worker/index.ts` — a thin entry that wraps the OpenNext-generated worker,
  **exports** `EditorRunDO` (wrangler requires the class exported from the
  worker named in its migration), and publishes the DO namespace to the run
  coordinator on each request.
- `tsconfig.worker.json` — type-checks the worker target separately from the
  Node/Next build (`npm run typecheck:worker`).

Set secrets:

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put DATABASE_URL
wrangler secret put RESEND_API_KEY
wrangler secret put EMAIL_FROM
```

[`@opennextjs/cloudflare`]: https://opennext.js.org/cloudflare

## Database

The default `DATABASE_URL="file:./dev.db"` is a local SQLite file and is **not**
suitable for a hosted, multi-instance deployment (no shared state, ephemeral
disk). For hosting, point Prisma at a networked database:

- **libSQL / Turso** — closest to the existing SQLite model; works from both the
  Node and Cloudflare paths via the Prisma libSQL adapter.
- **Postgres** (Neon, Supabase, RDS, etc.) — switch the Prisma datasource
  `provider` to `postgresql` and run `prisma migrate deploy`.

Whichever you choose, the durable-run design is unchanged: the database lease
(`EditorRun.lockToken` / `leaseExpiresAt`) remains the cross-process source of
truth, and the Durable Object is the fast, fleet-wide gate in front of it.

Story bible files (`canon.md`, `plot.md`, character notes, …) live as `BibleFile`
rows in that same database. On the hosted Worker they are D1 records, not files
under `data/<projectId>/bible/` — Workers have no durable filesystem. The
`/api/bible` surface is unchanged.

Prisma `db push` does not reach the Worker's D1 binding, so tables added after
the production database was created ship as re-runnable SQL under `prisma/`.

Production builds refuse to deploy while D1 is behind. On Workers Builds,
`npm run build` runs `scripts/check-d1-schema.mjs`, which compares the live D1
with `prisma/schema.prisma` and lists the `prisma/d1-*.sql` scripts to apply.
It fails `main` builds and only warns on preview branches. Run it yourself with
`npm run db:check:d1` (`npm run cf:deploy` runs it first). It needs the build
API token to have **Account > D1 > Read**; set `CICIRO_SKIP_D1_CHECK=1` as a
build variable to bypass it in an emergency.
Chapter version history needs `ChapterSnapshot`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-chapter-snapshots.sql
```

Until it runs, chapter writes keep working (automatic snapshots are best
effort) and only the History panel reports an error.

The manuscript scratchpad needs `ScratchNote`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-scratch-notes.sql
```

Until it runs, everything else keeps working and only the Scratchpad reports an
error.

The "Previously on" recap needs `ProjectRecap`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-project-recap.sql
```

Until it runs, everything else keeps working and the recap simply does not appear.

The shared password-attempt rate limiter (`src/lib/auth/rate-limit.ts`, used by
login and account deletion) needs `PasswordAttempt`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-password-attempts.sql
```

Unlike the other upgrades above, this one is not optional: both routes query
this table on every attempt, so until it runs, sign-in and account deletion
500 in production. Apply it before merging.

Login and deletion lock a password guess per account and address (5 in 15
minutes), cap an account across all addresses (50 per hour) and an address
across accounts (20 per 15 minutes). The address comes only from
`cf-connecting-ip`; a host without a trusted proxy that sets a real client-IP
header gets the account-wide ceiling alone.

The weekly review needs `WeeklyReview`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-weekly-reviews.sql
```

Until it runs, everything else keeps working and only the weekly review reports
an error. Writing a review also needs `ANTHROPIC_API_KEY`.

Beta reader links need `ShareLink` and `ShareComment`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-share-links.sql
```

Until it runs, only sharing errors: the Beta readers panels and the reader page.

Manuscript kinds (novel, screenplay, blog post, journal) add a `kind` column to
`Project`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-manuscript-kind.sql
```

Run it before deploying the build that ships kinds, not after. Every project
query reads `kind`, so until the column exists the whole app fails with
`no such column: kind`. Existing manuscripts become novels.

The AI-involvement disclosure summary needs `aiAcceptedWords`, `aiDraftedWords`,
`wordsAdded`, and `aiInvolvementSince` on `Chapter`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-ai-involvement.sql
```

Run it before deploying the build that ships the summary. Existing chapters'
counters start at zero from the migration's run time, not their creation, so
the UI notes that older acceptances predate tracking.

Sign in with Apple and Google needs `Identity` and `AuthHandoff`:

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-social-sign-in.sql
```

Until it runs, email and password keep working and only the Apple and Google
buttons fail.

Social sign-in also reads `User.emailVerifiedAt`, so run the additive upgrade
before deploying the build that ships it (a second run fails on the ALTER,
which is harmless):

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-email-verified.sql
```

Until it runs, every sign-in fails with `no such column: emailVerifiedAt`,
because Prisma selects the column on each `User` query. Existing accounts stay
unverified; a provider sign-in that matches one takes it over (see
[social sign-in](social-sign-in.md)).

Never relax a column on `User` (or any table other tables reference) by
rebuilding it on D1. D1 keeps foreign keys on, so the rebuild's `DROP TABLE`
fires `ON DELETE CASCADE` and empties every child table. That is why a
password-less account stores `passwordHash = ""` rather than NULL. The schema
check flags a column that is NOT NULL in D1 but optional in Prisma.

Email verification and password reset links need `EmailToken` (they set the
`User.emailVerifiedAt` column added above):

```bash
wrangler d1 execute ciciro --remote --file=prisma/d1-email-tokens.sql
```

Run it before deploying the build that ships them. Sign-in keeps working
without it, but account deletion and the data export also read `EmailToken`,
so until it runs they fail with `no such table: EmailToken`.

## Authentication

- `POST /api/auth/signup`: create an account and start a session.
- `POST /api/auth/login`: verify credentials and start a session.
- `POST /api/auth/logout`: end the current session.
- `GET  /api/auth/me`: the current user (or `null`).
- `GET  /api/auth/providers`: which Apple / Google buttons are configured.
- `GET  /api/auth/oauth/:provider/start`, `.../callback`: the Apple / Google
  browser flow; `POST /api/auth/apple/native` and `POST /api/auth/handoff` for
  the app. See [Sign in with Apple and Google](social-sign-in.md).
- `POST /api/auth/verify-email/resend`: email the signed-in user a new
  confirmation link (`429` with `Retry-After` inside the per-account cooldown).
- `POST /api/auth/verify-email`: spend a confirmation link (`{ token }`). The
  `/verify-email` page only looks the link up and shows a button that posts
  here, so a mail scanner opening the link verifies nothing.
- `POST /api/auth/password/forgot`: email a reset link. Answers the same
  whether or not the address has an account.
- `POST /api/auth/password/reset`: set a new password from a reset link and
  end every session the account has.

The links land on `/verify-email` and `/reset-password` (requested from
`/forgot-password`), which pass the auth gate. Link tokens follow the session
rule: only a SHA-256 hash is stored (`EmailToken`), each link works once, a
confirmation link lasts 48 hours and a reset link one hour, and a
completed reset retires the rest. An account is sent at most 5 reset emails
per rolling 24 hours (and one per minute), and the forgot-password answer is
the same whether or not one went out. Sign-in never waits on verification;
`User.emailVerifiedAt` records it, and a completed reset sets it too, since
the reset proved the address.

Sessions are httpOnly cookies (`ciciro_session`); the raw token never touches
the database — only its SHA-256 hash is stored, and a TTL sweeps expired rows.
Passwords use scrypt with a self-describing hash so parameters can evolve.

When `CICIRO_REQUIRE_AUTH=true`, `src/middleware.ts` redirects anonymous browser
traffic to `/login` and returns `401` for anonymous API calls. Route handlers
still verify the session with `getSessionUser`, since middleware only performs a
cheap cookie-presence check at the edge.

Beta reader links are the exception: `/read/:token` and `/api/read/:token/...`
pass the gate without a session, because the share token is their credential.
It opens only the chapters that link shares, and an unknown, revoked or expired
token gets a plain 404. Reader comments are rate-limited per reader address
using `cf-connecting-ip` on Cloudflare; other hosts need a proxy that sets
`x-real-ip` or `x-forwarded-for`, or every reader shares one budget (the
per-link limits hold either way).

## Run coordination on Cloudflare

Durable editor runs already checkpoint every model iteration and hold a database
lease. On Cloudflare, `EditorRunDO` adds a per-run serialization point:

1. `POST /api/chat` resolves the coordinator (`getRunCoordinator`).
2. It `acquire`s the run lock (routed to the run's DO on Cloudflare, or the
   in-process map locally). A second concurrent request gets `409`.
3. It claims the database lease and streams the slice.
4. On slice end it `release`s the lock. A crashed worker's lock self-clears via
   the DO alarm before the longer database lease expires.

This preserves every guarantee in [`docs/editor-agent-runs.md`](editor-agent-runs.md)
while making single-writer execution correct across many workers.

## Email

Transactional email goes through [Resend](https://resend.com) via
`src/lib/email` (`sendEmail`), a plain `fetch` call to Resend's HTTP API rather
than the `resend` SDK, so it needs no extra dependency and runs unmodified on
the Workers path. With no `RESEND_API_KEY` set, it logs the message and
returns instead of sending or throwing, so local dev and CI never need a real
key. Recipients are masked in that log, which is written at error level on a
hosted deploy (`CICIRO_REQUIRE_AUTH`) so a forgotten secret shows up. A caller
passing `throwOnError` gets a thrown error for a missing key too.

Templates live in `src/lib/email/templates.ts` as typed content blocks that
`render.ts` turns into both the HTML (React Email primitives in the shared
`layout.tsx`, light by default with an Ember dark palette for clients that
honor `prefers-color-scheme`) and the plain-text part. `account-emails.ts`
holds the sends the app makes: confirm your email (password signups), welcome
(when a password signup confirms its address, or when Apple or Google creates
the account; never when one links to an existing account), password reset and
account deleted. Each passes a Resend idempotency key so a retried request never sends twice, and
none of them throw, so a failed send never fails the signup or deletion
around it. The billing templates (payment failed, subscription canceled,
renewal reminder) are built but not sent yet.

To see every template, run `npm run dev` and open `/dev/emails`, which shows
each one in light, dark and plain text (`/dev/emails/<id>` serves the raw
HTML, `?format=text` the text part). Both 404 in production.

**Account setup, once per environment:**

1. In the Resend dashboard, add the sending domain (e.g. `ciciro.app`, or a
   dedicated subdomain like `mail.ciciro.app` to keep bounces/complaints away
   from the apex domain's reputation).
2. Add the DNS records Resend generates for that domain: an SPF `TXT` record
   (`v=spf1 include:amazonses.com ~all` merged into any existing SPF record, since
   a domain can only have one), the DKIM `CNAME`/`TXT` records Resend issues
   for signing, and a DMARC `TXT` record at `_dmarc.<domain>` (start at
   `p=none` to monitor, then move to `p=quarantine` once mail looks clean).
3. Wait for Resend to show the domain as verified (DNS propagation can take
   up to 24h, usually much less).
4. Create an API key scoped to sending only, and set it as the
   `RESEND_API_KEY` secret (`wrangler secret put RESEND_API_KEY` for the
   Workers path, or your container's secret store for Path A). Set
   `EMAIL_FROM` to an address on the verified domain, e.g.
   `"Ciciro <hello@mail.ciciro.app>"`.

**Not yet built:** a Resend webhook endpoint (delivery/bounce/complaint
events, verified with Svix signatures); add one when something needs to react
to those events; there is no route today.
