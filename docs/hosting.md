# Hosting Ciciro

Ciciro started as a local-first, single-author app (Next.js + SQLite on disk).
"Ciciro-hosted" turns it into a multi-tenant service. This document covers the
two supported deployment paths and the pieces they share: authentication, a
health probe, a serverless-friendly database, and the Durable-Objects-backed
run coordinator.

## What "hosted" adds

- **Accounts + sessions** (`src/lib/auth/**`). Email + password with scrypt
  hashing; opaque session cookies (only the token hash is stored). See
  [Auth](#authentication).
- **Auth enforcement** via `src/middleware.ts`, opt-in with
  `CICIRO_REQUIRE_AUTH=true`. Local development stays open by default.
- **Owner-scoped projects**. `Project.userId` links a manuscript to its owner;
  listing and project access are filtered per user.
- **Health probe** at `GET /api/health` for load balancers and uptime checks.
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

## Authentication

- `POST /api/auth/signup` — create an account and start a session.
- `POST /api/auth/login` — verify credentials and start a session.
- `POST /api/auth/logout` — end the current session.
- `GET  /api/auth/me` — the current user (or `null`).

Sessions are httpOnly cookies (`ciciro_session`); the raw token never touches
the database — only its SHA-256 hash is stored, and a TTL sweeps expired rows.
Passwords use scrypt with a self-describing hash so parameters can evolve.

When `CICIRO_REQUIRE_AUTH=true`, `src/middleware.ts` redirects anonymous browser
traffic to `/login` and returns `401` for anonymous API calls. Route handlers
still verify the session with `getSessionUser`, since middleware only performs a
cheap cookie-presence check at the edge.

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
