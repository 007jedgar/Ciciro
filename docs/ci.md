# Continuous integration

GitHub Actions runs the Vitest suite (and lint) on every pull request and on
every push to `main`. The workflow is [`.github/workflows/test.yml`](../.github/workflows/test.yml).

CI does **not** call Anthropic. Tests mock the model client and use a temporary
SQLite database created by `npm test` (`run-vitest.mjs`). A full production
`npm run build` is not part of this gate; it is slower and is not the required
check.

## What CI runs

1. Node.js 22
2. `npm ci`
3. `npx prisma generate`
4. `npm test` - fails the job if any test fails
5. `npm run lint`

## Required check name

To block merges to `main` until tests pass, require this status check:

**`test`**

That is the job `name` in the **Tests** workflow. GitHub's pull request UI may
show it as `Tests / test`. Pick the check for the `test` job, not a build job.

This repository cannot turn on branch protection by itself. A repo admin has to
tick the check in GitHub.

## Mark `test` required on `main`

1. Wait until this workflow has completed at least once (GitHub only lists
   checks it has seen).
2. Open **Settings → Branches**.
3. Edit or create a branch protection rule for `main`.
4. Enable **Require a pull request before merging**.
5. Enable **Require status checks to pass before merging**.
6. Search for and select **`test`**.
7. Save the rule.

If the repo uses rulesets instead of classic branch protection: **Settings →
Rules → Rulesets**, target `main`, enable **Require status checks to pass**,
and add **`test`**.

Until an admin does that, the workflow still runs on pull requests and reports
failures, but GitHub will not block the merge.
