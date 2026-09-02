# Accounts and secrets for hosted Ciciro

Operator checklist: create these accounts, set these variables, deploy. Not an architecture spec.

Deployment paths, Durable Objects, and the health probe are in [Hosting Ciciro](hosting.md). This page is the first-time account and secret list, plus how the mobile app points at that host.

Copy names exactly. Do not commit `.env` or Wrangler secrets.

## What you need (and what you do not)

| Account / service | Required? | Used for |
|---|---|---|
| [Anthropic](https://console.anthropic.com/) | Yes, for the assistant | Editor + drafter models |
| A networked database (Turso/libSQL or Postgres) | Yes, for hosted | Prisma `DATABASE_URL` |
| [Cloudflare](https://dash.cloudflare.com/) | Yes, for the Workers path | Wrangler deploy + Durable Object |
| Docker + a Node host | Alternative to Cloudflare | `Dockerfile` standalone server |
| [Groq](https://console.groq.com/) | Optional | Cheap chat-search ranking only |
| [Expo](https://expo.dev/) | For the mobile app | EAS / device builds later |
| GitHub | If you protect `main` | Required check `test` once CI lands |
| Extra identity provider (Google, Auth0, Clerk, …) | No | Email + password only |

There is no OAuth, magic link, or SSO in this repo. Auth is email, password (scrypt), and an httpOnly cookie named `ciciro_session`.

## Local `.env`

Copy [`.env.example`](../.env.example) to `.env` in the repo root (the Next.js app). Names the code actually reads:

| Variable | Required | Where it is read |
|---|---|---|
| `ANTHROPIC_API_KEY` | For chat / drafting | `src/lib/anthropic.ts` |
| `DATABASE_URL` | Yes | Prisma (`prisma/schema.prisma`) |
| `CICIRO_EDITOR_MODEL` | No | Default `claude-opus-5` (also accepts legacy `CICIRO_MODEL`) |
| `CICIRO_DRAFTER_MODEL` | No | Default `claude-sonnet-5` |
| `CICIRO_DRAFTER_FAST_MODEL` | No | Default `claude-haiku-4-5` |
| `CICIRO_REQUIRE_AUTH` | Hosted | Middleware + `/api/health`. Set to the string `true`. |
| `CICIRO_STANDALONE` | Docker build | `next.config.mjs`; the Dockerfile sets this. |
| `GROQ_API_KEY` | No | `src/lib/fast-lane.ts` |
| `CICIRO_ROUTER_MODEL` | No | Groq ranker model; default `llama-3.1-8b-instant` |

`.env.example` does not list `CICIRO_REQUIRE_AUTH`. Local single-author use stays open when it is unset or anything other than `true`. For a local rehearsal of hosted mode:

```bash
CICIRO_REQUIRE_AUTH=true
```

Then sign in at `/login` or create an account at `/signup`.

Never put `ANTHROPIC_API_KEY` (or `GROQ_API_KEY`) in the mobile app. The phone talks only to your hosted origin.

## Auth (what exists)

Implementation: `src/lib/auth/**`, `src/app/api/auth/**`, `src/middleware.ts`.

- **Signup:** `POST /api/auth/signup` with JSON `{ "email", "password", "name?" }`. Password at least 8 characters. Creates the user and a session. Browser page: `/signup`.
- **Login:** `POST /api/auth/login` with JSON `{ "email", "password" }`. Browser page: `/login`.
- **Logout:** `POST /api/auth/logout`.
- **Who am I:** `GET /api/auth/me` returns `{ "user": { id, email, name } | null }`.
- **Session cookie:** `ciciro_session` (constant `SESSION_COOKIE` in `src/lib/auth/constants.ts`). httpOnly, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, path `/`, TTL 30 days. Only the SHA-256 of the token is stored.
- **Passwords:** scrypt, self-describing hash `scrypt$N$r$p$saltHex$hashHex`.

Enable the gate with `CICIRO_REQUIRE_AUTH=true`:

- Anonymous browser routes redirect to `/login`.
- Anonymous `/api/*` calls get `401` except `/api/auth/*` and `/api/health`.
- Route handlers still call `getSessionUser` / `authorizeProject`. Middleware only checks that the cookie is present.

Cloudflare already sets this as a Wrangler **var** (not a secret) in `wrangler.jsonc`:

```jsonc
"vars": { "CICIRO_REQUIRE_AUTH": "true" }
```

The Docker image sets `ENV CICIRO_REQUIRE_AUTH=true`.

Owner-scoped manuscripts: `GET /api/projects` lists the signed-in user's projects; `GET /api/projects/:id` is authorized the same way.

## Database

Prisma schema: `prisma/schema.prisma`. Datasource `provider` is `sqlite`; URL comes from `DATABASE_URL`.

| Mode | `DATABASE_URL` example | Use |
|---|---|---|
| Local single-author | `file:./dev.db` (the `.env.example` default) | Fine on one machine. File lives under `prisma/` (gitignored). |
| Hosted | libSQL/Turso URL, or Postgres after you change `provider` | Required for Cloudflare and any multi-instance Node host |

On-disk SQLite is **not** for hosted or multi-instance: workers do not share that file, and Cloudflare's disk is ephemeral. See [Hosting - Database](hosting.md#database).

This repo has **no** `prisma/migrations/` directory. Day to day:

```bash
npm run setup      # prisma generate && prisma db push
npm run db:push    # schema -> current DATABASE_URL
npx prisma generate
```

`docs/hosting.md` mentions `prisma migrate deploy` as a release step if you introduce a migration history (typical after switching the datasource to `postgresql`). Until that folder exists, `db push` is what this tree actually runs.

After changing `provider` to `postgresql`, generate and push (or migrate) against the hosted URL **before** the first Workers/Docker boot, or Prisma will fail at runtime.

## Anthropic

1. Create a key at https://console.anthropic.com/
2. Local: `ANTHROPIC_API_KEY=` in `.env`
3. Hosted: Wrangler secret or container env (below)

The manuscript editor UI loads without a key. `POST /api/chat` returns 500 until the key is set (`getAnthropic()`).

## Optional Groq

Used only to rank/suggest chat-search candidates. Advisory: the editor (Opus) still decides what to open. Continuity compaction never uses Groq. If unset or Groq errors, Haiku is used.

1. Key from https://console.groq.com/
2. Set `GROQ_API_KEY` locally and, if you want it in production, `wrangler secret put GROQ_API_KEY` (or the Docker `-e` equivalent)
3. Optional override: `CICIRO_ROUTER_MODEL` (default `llama-3.1-8b-instant`)

## Cloudflare (Workers + OpenNext)

You need a Cloudflare account and Wrangler logged in.

```bash
npx wrangler login
```

Secrets (prompted, not committed):

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put DATABASE_URL
# optional:
# npx wrangler secret put GROQ_API_KEY
```

Do **not** `secret put` `CICIRO_REQUIRE_AUTH`; it is already a plain var in `wrangler.jsonc`. Model overrides can be extra `vars` if you want them off the defaults.

The Durable Object binding and the `v1` SQLite class migration for `EditorRunDO` are already in `wrangler.jsonc`. First deploy applies that migration; you do not add a second one unless you change the DO class.

```bash
npm run cf:build      # prisma generate + OpenNext
npm run cf:preview    # local workerd
npm run cf:deploy     # wrangler deploy
```

Confirm `GET https://<your-worker>/api/health` returns `status: "ok"` and `authRequired: true`.

Full path notes: [Hosting - Path B](hosting.md#path-b--cloudflare-workers-opennext--durable-objects).

## Docker / Node

The `Dockerfile` is a Node 22 multi-stage image. It sets `CICIRO_STANDALONE=true` at build (Next standalone output) and `CICIRO_REQUIRE_AUTH=true` at runtime. Healthcheck hits `/api/health`.

```bash
docker build -t ciciro .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e DATABASE_URL="libsql://..." \
  -e CICIRO_REQUIRE_AUTH=true \
  ciciro
```

Point `DATABASE_URL` at the same hosted database you would use on Cloudflare. Apply the Prisma schema to that database before traffic hits the container.

## Mobile app (`apps/mobile`)

The app is a client of the **hosted** HTTP API. It must not ship model keys.

1. Expo account at https://expo.dev/ (needed for EAS device builds; `npx expo start` works without one)
2. In `apps/mobile`, `npm install` (this tree uses `legacy-peer-deps` so Expo's React pin does not fight the Next.js install above it)
3. In `apps/mobile/.env` (or your shell):

```bash
EXPO_PUBLIC_API_URL=https://your-ciciro-host.example
```

No trailing slash. Local Next against a simulator:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3000
```

On a physical device, `localhost` is the phone. Use your machine's LAN IP or a tunnel, and keep `CICIRO_REQUIRE_AUTH` consistent with that server.

The client sends `credentials: 'include'` and, because React Native does not treat `httpOnly` cookies like a browser, also stores the `ciciro_session` value from `Set-Cookie` and sends it as a `Cookie` header. Cookie-jar quirks on some devices are a follow-up; the screens and `apps/mobile/lib/api.ts` are the contract.

## GitHub CI

Current `main` does not yet include `.github/workflows` or `docs/ci.md`. When that workflow lands, a repo admin should require the check named **`test`** on `main` (Settings → Branches or Rulesets). Until then, run `npm test` locally before you merge.

## First time hosted (ordered)

1. Create an Anthropic API key.
2. Create a Turso (libSQL) or Postgres database. Put its URL in `DATABASE_URL`. Do not use `file:./dev.db` on the host.
3. From this repo, with that URL in the environment: `npx prisma generate` and `npm run db:push` (or `prisma migrate deploy` once you have a migrations folder).
4. Cloudflare path: `npx wrangler login`, then `npx wrangler secret put ANTHROPIC_API_KEY` and `npx wrangler secret put DATABASE_URL`. Confirm `wrangler.jsonc` still has `CICIRO_REQUIRE_AUTH=true` and the `v1` / `EditorRunDO` migration.
5. `npm run cf:deploy`. Hit `/api/health`.
6. Open `/signup` on the deployed origin, create an account, then `/login` as a second check. Create a manuscript.
7. Docker alternative to steps 4-5: `docker build -t ciciro .` and `docker run` with the same two env vars (auth is on in the image).
8. Optional: Groq key as `GROQ_API_KEY`.
9. Mobile: `cd apps/mobile && npm install`. Set `EXPO_PUBLIC_API_URL` to the origin from step 5 or 7. Then `npx expo start`. Sign in against that host. The app never gets `ANTHROPIC_API_KEY`.
10. When CI exists, mark GitHub check `test` required on `main`.
