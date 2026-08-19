# Contributing to Ciciro

Thanks for wanting to help. Ciciro is a local-first manuscript editor with one
visible AI partner (the editor) and backstage drafters. Keep that split intact
unless a change is explicitly about the architecture.

## Development setup

You need Node.js 20+, npm, and an Anthropic API key for the assistant. The
manuscript editor itself runs without a key.

```bash
git clone https://github.com/007jedgar/Ciciro.git
cd Ciciro
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY
npm run setup             # prisma generate + create the SQLite db
npm run dev               # http://localhost:3000
```

Do not commit `.env`, `data/`, or SQLite databases. Those are local author
content.

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Generate the Prisma client and push the schema to SQLite |
| `npm run dev` | Next.js dev server |
| `npm test` | Vitest suite (fresh temp SQLite per run) |
| `npm run lint` | ESLint |
| `npm run build` | Prisma generate + production Next.js build |
| `npm run db:push` | Apply schema changes to the local db |
| `npm run db:studio` | Inspect the local db |

Run `npm test` and `npm run lint` before opening a pull request. If you change
`prisma/schema.prisma`, also run `npm run db:push` and include the schema in the
same PR.

## Where to look

- Editor agent loop: `src/lib/editor-run.ts`, `src/app/api/chat/route.ts`
- Tools and manuscript mutations: `src/lib/tools.ts`
- Story bible on disk: `src/lib/bible.ts`, `src/lib/context.ts`
- Prompts and quick actions: `src/lib/prompts.ts`
- Durable-run contract: [`docs/editor-agent-runs.md`](docs/editor-agent-runs.md)
- UI: `src/components/Workspace.tsx`, `ChatPanel.tsx`, `Editor.tsx`, `StoryBible.tsx`

The editor (Opus) is the only model the author talks to. Drafters (Sonnet/Haiku)
run only through `dispatch_draft`. Do not expose a second chat partner or dump
the whole manuscript into a prompt; retrieval stays on-demand.

## Conventions

- TypeScript, App Router, no extra UI library. Match the surrounding file.
- Prefer small, named helpers over clever one-liners.
- Keep comments that explain *why* (tool contracts, retrieval tiers, run
  lifecycle). Skip comments that restate the next line.
- Story-bible and prompt copy uses hyphens, not em dashes - that is a product
  rule, not a typography preference.
- User manuscripts live in `data/<projectId>/`. Tests must use a temporary
  database and must not read or write an author's project.

## Tests

Tests live in `test/` and run with Vitest. Prefer fixture-based regressions for
editor intent, structural tools, and run lifecycle. If you change completion,
verification, or passage addressing, add or update a fixture rather than relying
on a live model call.

## Pull requests

1. Branch from `main` with a short, descriptive name.
2. Keep the change focused. Docs-only, UI-only, and agent-loop changes are
   easier to review as separate PRs.
3. Describe the *why* in the PR body. Link any related issue.
4. Note how you tested (commands plus a short manual check if the UI changed).

Bug reports are welcome as issues: expected vs actual, steps, and whether the
editor run was still `continuing` when it looked stuck.
