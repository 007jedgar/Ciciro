# CI

GitHub Actions runs the **`test`** check on every pull request and on pushes to
`main`. `main` is protected: the branch cannot be force-pushed or deleted, and
a PR cannot merge until that check is green on the latest commit.

`test` is a gate. The work runs in two jobs at the same time, and the gate
passes only when both do. The ruleset requires the check named `test`, so that
job id has to stay.

## Web

1. `npm ci` and `npx prisma generate`
2. `npm run lint`
3. `npm run typecheck` and `npm run typecheck:worker` (Cloudflare Worker types)
4. `npm test` (Vitest, temp SQLite)

## Mobile

1. `npm ci` in `apps/mobile`
2. `npm run typecheck:mobile`
3. `npm run test:mobile` (Jest)

Vitest runs one file at a time. The suite shares one temp SQLite database, so
files cannot run in parallel.

Node 22 comes from `.nvmrc`. No API keys are required.

## Local equivalent

```bash
npm ci
npm ci --prefix apps/mobile
npx prisma generate
npm run lint
npm run typecheck
npm run typecheck:worker
npm run typecheck:mobile
npm test
npm run test:mobile
```
