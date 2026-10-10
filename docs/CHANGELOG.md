# Changelog

User-facing changes only. Model default changes go here (see `AGENTS.md`); everything
else stays in commit messages.

## Unreleased

- **Screenplays (Beta) get professional output.** A script now has a **title
  page** (title, credit, author, source, draft date and contact, edited under
  "This screenplay" in Settings on the web and the phone) that opens the
  screenplay PDF and the Fountain and FDX files. The page count is now exact
  rather than "about": the header says "N pages", and the editor, the count and
  the PDF break pages in the same places, with `(MORE)` at the foot of a page a
  speech runs past and the cue again with `(CONT'D)` at the top of the next (each
  is a switch in Settings, and takes a line of the page). **Dual dialogue** sets
  two speeches side by side (Alt+Shift+D on the web, a Dual button on the
  phone), **centered text** is a new element (Alt+Shift+8), and **scene numbers**
  for a locked draft appear in both margins of the editor and the PDF. Export
  also gets **FDX export** (Beta), and `.fdx` files import as new screenplays;
  Ciciro does not claim Final Draft opens them unchanged. Fountain carries the
  title page, `^` dual dialogue, `> centered <` text and `#1#` scene numbers both
  ways. The phone shows and keeps all of it, exports FDX from its Export card,
  and edits the title page in Settings; it still does not lay out the page.
  Script formatting remains English and Spanish for the PDF, and the `(MORE)`
  and `(CONT'D)` notes are English.

- **Screenplays (Beta) export and import.** Export a script as a **Screenplay
  PDF** (US Letter, 12 pt Courier, page numbers from page 2, the same pages the
  editor's "about N pages" counts) or as a **Fountain** file for other writing
  apps, on the web and from the phone's Export card. Import a `.fountain` file
  as a new screenplay (one sequence for each `#` section, or one sequence), and
  paste Fountain text into a script on the web to have it sorted into elements.
  Script formatting is only available in English and Spanish for now: the
  screenplay PDF of a script written in another alphabet, and the phone's
  Screenplay choice when the app is in Chinese or Hindi, are grayed out with an
  info button that says so, and support for more languages is planned. The web
  no longer loads Courier Prime twice.

- **Ciciro understands screenplays.** It reads a script by its elements (scene
  headings, cues, dialogue, parentheticals, transitions, shots) and by its
  scenes, so it can name, find and rewrite a scene by its heading, and what it
  writes, rewrites or auto-drafts lands as the right elements and continues from
  the element the script reached. The manuscripts list and a script's meta line
  say about how many pages it runs. On the phone, a new **Pages** tool shows a
  screenplay as printed pages (read only, Beta), the element bar sits above the
  keyboard and lights the right element the moment you press Return, and a
  script draft in the chat is set as a script.

- **Screenplays** are tidier to write. Typing `# `, `- `, `1. ` or `> ` at the
  start of a line no longer turns it into a heading, list or quote, and
  pasting several lines sorts them into scene headings, cues, dialogue and
  transitions. Tab and Shift-Tab change every selected line at once and no
  longer move focus off the page, Enter on an empty scene heading turns it into
  action, and Enter in the middle of a speech keeps both halves dialogue. The
  script uses Courier Prime on every machine. On the phone, a draft you insert
  from Ciciro arrives as script lines instead of plain paragraphs. Scene
  headings, character cues and transitions are skipped by spell check and the
  grammar pass.

- On the phone, a manuscript can have a **deadline**: a due date and a word
  target for the whole manuscript, set from the new Deadline tool on its
  chapters screen (and changed or removed there). A ring fills as the words
  arrive and closes with a tick when the target is met. Ciciro reads your last
  two weeks of writing against the words a day the deadline still needs and
  says plainly whether you are comfortably ahead, on track, or would do well to
  pick up the pace, with the daily words it takes. Deadlines are optional and
  independent of the daily word goal.

- On the iPhone, highlighting words in the chapter editor shows the same menu
  under the selection (above it, clear of the system Cut and Copy bar, when the
  keyboard leaves no room). One word offers its synonyms as chips, with the rest
  behind "more...", and tapping one swaps it in place and keeps your cursor.

- On the website, highlighting words in the chapter shows a small menu over
  them. Two or more words offer Comment, Rewrite, Describe, Expand and Fix
  (each sends Ciciro a brief about that text, and Comment starts a chat with it
  quoted); one word offers Comment, Describe and Fix plus synonyms that fit its
  sentence, and choosing one swaps it in place. Cmd+K (Ctrl+K) moves into the
  menu from the keyboard.

- On the phone, tapping anywhere around the page in the chapter editor (the
  margins, the chapter title row, the pills) puts the keyboard away. The
  selected tab in the manuscript tab bar now fills its whole segment of the bar,
  rounder at the two ends and flatter in the middle. The Ciciro chat shows its
  quick-action chips on an empty chat only; once you are talking they sit behind
  a sparkle button. "Previously on" is now two or three sentences (web and
  phone), and the phone clamps it to five lines with Show more.

- **Who knows what** is now chapter by chapter (web and phone). A character
  can know, suspect, believe wrongly, or not know something, from a chapter
  until the chapter it changes in; facts saved as "believes" read as
  "suspects". The Knowledge screen opens at the chapter you have open, with a
  chapter scrubber, a timeline per character that shows what ended and what
  replaced it, and a grid by topic with an optional Reader column from
  canon.md. Ciciro's editing, the continuity check and What changed now see
  only what characters know by the chapter in question, never a later one.
- Ask Ciciro in chat to record who knows what ("note that Joe suspects Suzy
  has the pen"): it records it against the chapter you have open, or the one
  you name, says exactly what it recorded, and can change or remove it. "What
  does Joe know at this point?" answers from the ledger as of your chapter.
  This works in Chat only too.

- Fixed: on the phone, typing in a chapter after switching from another one no
  longer fails to save with an "Unexpected null or undefined value" error.

- The phone's Ciciro chat now has the website's quick-action chips above the
  message box (What needs work most?, Critique this chapter, Tighten dialogue,
  Find loose ends, and the rest, different for a novel, screenplay, blog post
  or journal). A tap sends the brief; the ones that work on a passage need
  words highlighted in the manuscript first, and the ones that change the
  manuscript need Allow edits. This replaces the three starter prompts the
  empty chat used to offer. Rewrite from the writing tools now works on the
  words you have highlighted.
- On the phone, a manuscript has a **Manuscript details** tool (in the Tools
  row on the chapters screen) to change its title, author and logline, move it
  between folders, or delete it. Chapters can be renamed from a title line
  above the page, which also says which chapter you are in. The chapters
  screen shows the manuscript's total word count.
- Phone Settings is grouped under Appearance, Writing, Ciciro, Goals and
  reminders, and Privacy, and Writing history is listed there. The + menu on
  the manuscripts list is only for creating (new manuscript, import, new
  folder), and the writing-tools grid no longer repeats Chapters and
  Typography. Sign-in and sign-up move from field to field with Return and
  submit from the password. The manuscript tab bar now labels its three tabs
  (Chapters, Manuscript, Ciciro), the empty chat's prompt is no longer drawn
  upside down, and deleting a manuscript returns to a library that shows its
  remaining manuscripts instead of a blank list.
- On the phone, Settings' Goals and reminders is now three rows (Word goal,
  Writing reminders, Writing history), each opening its own screen instead of
  adjusting the goal inline. A word goal is optional: pick **No goal** on the
  Word goal screen to hide the writing meter, and a writing reminder can be
  saved without a word count, so it simply says "Time to write".

- The phone app has the website's Archive look as two new themes, **Ciciro** and
  **Ciciro Night**, now the default for anyone who has not picked a theme. The
  chapters screen is restyled in it (new typefaces, folder-tab chapter cards,
  paper-stock stage chips) and the app's text uses Newsreader, Instrument Sans
  and JetBrains Mono. Four themes are renamed: Sage is **Marginalia**, Ember is
  **First Edition**, Walnut is **Bookshelf**, Candle is **Dog-Ear**; Parchment
  and Inkwell keep their names, and everyone keeps the theme they picked. This
  needs a new app build; an over-the-air update does not carry the fonts.

- New **Allow edits / Chat only** switch under Ciciro's chat (web and phone). It
  belongs to the conversation: a new chat starts on Allow edits, and Chat only
  stays on for as long as that conversation continues. In Chat only, Ciciro
  answers and discusses but never changes your manuscript; the server withholds
  its writing tools, so it holds even when a page or app is out of date.

- **Stop** in Ciciro's chat (web and phone) now actually stops a request. Ciciro
  finishes the step it is on, then stops before its next tool call; anything it
  already wrote stays and can be undone.

- Auto-draft and the chat's draft tool no longer put text that was cut off
  mid-sentence into your chapter. A beat that runs past its length limit now
  fails and can be retried, and Recap and chapter summaries keep their previous
  version instead of saving a cut-off one.

- The website has a new look, the Archive design language: paper texture, richer
  color, and a light/dark toggle on the public pages. `/` is now the landing page
  for signed-out visitors (the library for signed-in ones), with app screenshots
  and short demos, and `/launch` redirects there. The pricing page shows an
  early-access discount when one is set up (see `docs/billing.md`).

- New opt-in setting, **Experimental writing prompt** (Settings, web and
  phone, off by default): Ciciro's drafts follow craft defaults that avoid
  habits common in model-written prose (feelings mirrored by the weather,
  stated themes, "not X but Y" contrasts, tidy endings), and a check after
  each draft points the editor at any that slipped through. Your `style.md`,
  your voice notes, and anything a brief asks for still win. Off, drafting
  works exactly as before.

- Em dashes stay off by default; a `- Em dashes: allowed` line in `style.md`
  switches them on for drafts, with or without the experimental setting.

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
