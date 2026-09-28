# Changelog

User-facing changes only. Model default changes go here (see `AGENTS.md`); everything
else stays in commit messages.

## Unreleased

- Settings (web and mobile) now shows the models Ciciro is actually running: Editor,
  Drafter, Quick drafts, and the Groq router when configured. Current defaults, set in
  `src/lib/anthropic.ts` and `src/lib/fast-lane.ts`:
  - Editor: Claude Opus 5 (`claude-opus-5`)
  - Drafter: Claude Sonnet 5 (`claude-sonnet-5`)
  - Quick drafts: Claude Haiku 4.5 (`claude-haiku-4-5`)
  - Router (when `GROQ_API_KEY` is set): Llama 3.1 8B (`llama-3.1-8b-instant`)
- Editor default is now Claude Opus 5.5 (`claude-opus-5-5`), was Claude Opus 5
  (`claude-opus-5`). The drafter stays on Claude Sonnet 5.
