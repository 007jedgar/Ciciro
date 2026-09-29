# Changelog

User-facing changes only. Model default changes go here (see `AGENTS.md`); everything
else stays in commit messages.

## Unreleased

- Auto-draft and the chat's draft tool no longer put text that was cut off
  mid-sentence into your chapter. A beat that runs past its length limit now
  fails and can be retried, and Recap and chapter summaries keep their previous
  version instead of saving a cut-off one.

- The website has a new look, the Archive design language: paper texture, richer
  color, and a light/dark toggle on the public pages. `/` is now the landing page
  for signed-out visitors (the library for signed-in ones), with app screenshots
  and short demos, and `/launch` redirects there. The pricing page shows an
  early-access discount when one is set up (see `docs/billing.md`).

- Drafter default is now Claude Sonnet 5.5 (`claude-sonnet-5-5`), was Claude Sonnet 5
  (`claude-sonnet-5`). Same per-token price. No request-shape changes were needed.
  Anthropic's migration guidance for Sonnet 5.5 is: "`thinking: {type: "disabled"}`
  returns a 400 - to turn thinking off, send `thinking: {type: "between_tools"}`"
  (a breaking change from Sonnet 5, which accepted `{type: "disabled"}`). But that
  only affects callers that explicitly disabled thinking. Per Anthropic's own
  thinking/effort reference table, *omitting* `thinking` already ran adaptive
  (thinking on) on Sonnet 5 - "Omitting `thinking`: Runs adaptive" - and continues
  to run adaptive on Sonnet 5.5 - "Omitting `thinking`: Runs **adaptive**". Every
  Ciciro drafter call (`recap.ts`, `continuity.ts`, `weekly-review.ts`,
  `style-analysis.ts`, `tools.ts` dispatch_draft, `autowrite.ts` draftBeat) omits
  `thinking` rather than disabling it, so the `between_tools` note does not apply
  and behavior is unchanged.

- Ciciro now sends email: a link to confirm your address after signing up, a
  welcome once it's confirmed, password reset links ("Forgot password?" on web
  and mobile sign-in), and a note when an account is deleted. Settings shows
  when your email isn't confirmed yet and can resend the link.
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
