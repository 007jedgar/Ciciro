# CI

GitHub Actions runs the **`test`** check on every pull request and on pushes to
`main`. `main` is protected: the branch cannot be force-pushed or deleted, and
a PR cannot merge until that check is green on the latest commit.

## What `test` runs

1. `npm run lint`
2. `npm run typecheck`, `typecheck:worker`, and `typecheck:mobile`
3. `npm test` (Vitest, temp SQLite)
4. `npm run test:mobile` (Jest)

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
