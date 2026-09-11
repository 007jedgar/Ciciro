# Agent instructions

## Merge conflicts

Resolve PR / branch conflicts by **rebasing** onto the base branch. Do not merge `main` (or `master`) into the feature branch to clear conflicts.

- `git fetch origin && git rebase origin/main` (or the PR's base branch)
- Never `git rebase -i` (no interactive rebase)
- After each conflict: edit, `git add`, `git rebase --continue`
- Already-pushed branch: `git push --force-with-lease`
- Never force-push `main` / `master`
- If a rebase is in progress, finish or abort it — do not start a merge
