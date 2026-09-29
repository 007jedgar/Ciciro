# Changelog

User-facing changes only. Model default changes go here (see `AGENTS.md`); everything
else stays in commit messages.

## Unreleased

- Drafter default is now Claude Sonnet 5.5 (`claude-sonnet-5-5`), was Claude Sonnet 5
  (`claude-sonnet-5`). Same per-token price. No request-shape changes were needed:
  every drafter call already omits `thinking`, which runs adaptive on both models.

- Settings (web and mobile) can now export all of your data as one zip and delete
  your account. `/account/delete` explains account deletion publicly, for the
  App Store and Google Play deletion requirements.

- Sign in with Apple and Google on the web and in the app, next to email and
  password. A verified email that matches an existing account signs into it.
  An account without a password confirms deletion by typing DELETE, and deleting
  it revokes Ciciro's Sign in with Apple access. See `docs/social-sign-in.md`.

- Settings (web and mobile) now shows the models Ciciro is actually running: Editor,
  Drafter, Quick drafts, and the Groq router when configured. Current defaults, set in
  `src/lib/anthropic.ts` and `src/lib/fast-lane.ts`:
  - Editor: Claude Opus 5 (`claude-opus-5`)
  - Drafter: Claude Sonnet 5 (`claude-sonnet-5`)
  - Quick drafts: Claude Haiku 4.5 (`claude-haiku-4-5`)
  - Router (when `GROQ_API_KEY` is set): Llama 3.1 8B (`llama-3.1-8b-instant`)
- Editor default is now Claude Opus 5.5 (`claude-opus-5-5`), was Claude Opus 5
  (`claude-opus-5`). The drafter stays on Claude Sonnet 5.
