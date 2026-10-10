# Screenplay formatting

Screenplay is a manuscript kind (`Project.kind = "screenplay"`, see
`src/lib/manuscript-kind.ts`). It is in **Beta**: every place an author meets
the formatting says so (the kind pickers, the element bar, the Settings
section), on the web and the phone. This page is how it works and where to
change it. The writer-facing description is in `docs/using-ciciro.md`.

## The document

A script is ordinary block HTML. An element is the `data-sp` attribute on a
paragraph (`<p data-sp="dialogue">`); "action" is the absence of the attribute.
Nothing about it touches the schema, the op log, sync, snapshots, tracked
changes or comments, because the server treats a block's `html` as opaque. Flat
element-tagged blocks are the source of truth. Fountain is an interchange
format (import, export, paste), never the stored one.

| Element | Value | Tab slot |
|---|---|---|
| Scene heading | `scene-heading` | last |
| Action | `action` (no attribute) | first |
| Character | `character` | 2nd |
| Dialogue | `dialogue` | 3rd |
| Parenthetical | `parenthetical` | 4th |
| Transition | `transition` | 5th |
| Shot | `shot` | 6th |

Tab walks that ring and Shift-Tab walks it back. Enter starts the element that
usually follows (`nextElementOnEnter`). A shot behaves like a scene heading
for layout and for Enter (the next line is action), is set in capitals, and is
not bold.

### Forward compatibility

Both clients rewrite a block on every edit, so an old client that collapsed an
element it did not know to action would strip a newer client's elements. The
rule: **the tag is stored as written, the element is only for laying out.**

- `elementTag` / `elementTagOfHtml` read a `data-sp` value and keep any plain
  slug (`[a-z0-9_-]`, up to 32 characters), known or not. Anything else
  (blank, markup) reads as `action`, so a tag can never break out of its
  attribute.
- `normalizeElement` / `elementOfHtml` return a known element, with `action` for
  one this build does not know. Use them to decide behaviour (Tab, Enter, which
  chip is lit), never to decide what to store.
- `withElement(html, tag)` takes any tag. The TipTap `Screenplay` extension and
  the phone's `restampCiciroHtml` / `serializeBlockHtml` store the tag.
- A line with an unknown element lights no chip, lays out as action, and Tab
  steps on from action.
- When Ciciro rewrites a run of blocks (`blockReplace` in `src/lib/tools.ts`),
  a replaced shot or unknown tag stays on the replacement's first line
  (`classifyReplacement` in `manuscript-kind.ts`) instead of being re-guessed;
  only a plain scene heading or transition replaces it. The classifier for the
  assistant's plain lines (`classifyScreenplayLines`) reads camera directions
  (CLOSE ON, ANGLE ON, POV, INSERT and the like) as shots.

Ship readers before writers: a new element value must be understood by the
normalizer in both clients before anything writes it. Mobile JS goes out over
the air, so that is quick.

## The shared engine

`src/lib/screenplay.ts` is pure (no imports, no DOM, no I/O) and mirrored byte
for byte to `apps/mobile/lib/screenplay.ts` (`test/screenplay-parity.test.ts`).
It owns:

- the element model above, the Alt+Shift shortcut order, and the tag helpers;
- the page: `PAGE_COLUMNS = 60`, `PAGE_LINES = 54`, `ELEMENT_METRICS`
  (indent, width, alignment, caps, bold per element), `blankLinesBefore`;
- `wrapText`, `layoutBlock`, `layout`: set blocks on the page, line by line;
- `paginate`, `typeset`, `pagesAsText`: break laid-out blocks into pages;
- `scriptBlocksFromHtml`, `layoutHtml`, `sequenceCursors`, `estimatePages`:
  from chapter HTML to a page count;
- `scenes` and `dialogueGroups`: structure derived from the flat blocks;
- `styledBlocksFromHtml` (blocks with their bold / italic / underline runs),
  `sliceRuns`, and `typesetSequences` (every sequence set on pages that run on
  from one another, each row knowing its sequence, block and offset): what the
  PDF draws;
- `SCRIPT_LANGUAGES`, `scriptLanguageSupported(code)`,
  `scriptTextSupported(text)` and `scriptHtmlSupported(chapters)`: which
  languages script formatting covers.

`manuscript-kind.ts` (also mirrored) re-exports the element model, so older
imports keep working.

### The page

Fixed on purpose: 12pt Courier at 10 characters an inch gives a 60 column
measure (6.0 inches) and 54 lines (9.0 inches at 6 lines an inch). Every glyph
is the same width, so a pure function can say exactly which words land on
which line. Columns count from the 1.5 inch left margin:

| Element | Indent | Width | Notes |
|---|---|---|---|
| Scene heading | 0 | 60 | capitals, bold |
| Action | 0 | 60 | |
| Character | 22 | 38 | capitals. The cue's position differs between Final Draft, Nicholl and afterwriting, so this is the number most worth tuning |
| Dialogue | 10 | 35 | |
| Parenthetical | 16 | 25 | set in brackets |
| Transition | 30 | 30 | capitals, flush right |
| Shot | 0 | 60 | capitals |

Spacing is one blank line between blocks, none inside a speech (a
parenthetical or dialogue answering the line above sits directly under it, see
`SPEECH_RUNS`). Final Draft's default may put two blank lines above a scene
heading; if real scripts show a count drifting long, change
`blankLinesBefore` (and the CSS rule it mirrors) and regenerate the golden.

Wrapping matches a browser setting `white-space: pre-wrap` in a monospace face:
break after spaces and after a hyphen between letters, let spaces hang off the
end of a line, keep leading spaces, break a word longer than the measure where
it overflows, `\n` is a hard line break. A combining mark takes no column and a
wide (CJK) character takes two.

Pagination (`paginate`) is an **estimate**, labelled "about N pages":

- a scene heading, shot, cue or parenthetical stays on the page with what
  follows it;
- an action or a speech may break across a page only with two lines on each
  side; anything else moves whole;
- a break drops the blank line at the top of the page;
- there is no `(MORE)` and `(CONT'D)` yet (phase 3), and "a page is a minute" is
  a rule of thumb, not a measurement.

Sequences (chapters) run on from one another with continuous page numbers:
`sequenceCursors` gives where each starts, `estimatePages` the total. The PDF
sets them the same way (`typesetSequences`), so its page count is the editor's.

### Tests

- `test/screenplay.test.ts`: the element helpers, wrapping, layout,
  pagination, the HTML reader and the structure helpers, plus a golden:
  `test/fixtures/screenplay/night-shift.ts` set on the page must equal
  `night-shift.pages.txt`, which is the pages themselves, so a layout change
  shows as a diff of what the author would print. `UPDATE_GOLDEN=1` rewrites it;
  read the diff before committing it.
- `test/screenplay-parity.test.ts`: the two copies are identical.
- `test/screenplay-css.test.ts`: the editor's `ch` numbers equal
  `ELEMENT_METRICS`, and the speech-run selectors equal `SPEECH_RUNS`.
- `test/screenplay-editor.test.ts`: the TipTap extension and the page markers.
- `test/script-lines.test.ts`: the marked-line contract (below), its phone
  mirror, and a round trip of the golden script through the model view.
- `test/script-pages.test.ts`: the phone's page view built from the engine
  equals `pagesAsText(typeset(...))`.

## Export, import and paste

### Screenplay PDF

`src/lib/export/screenplay-pdf.ts` (`buildScreenplayPdf`) draws
`typesetSequences` with pdf-lib's standard Courier fonts: US Letter, 1.5in left
margin, 1.0in top, 12pt on a 12pt leading, so a column is 7.2pt and the 54-line
page fits the 9in text area. Page numbers (`2.`) sit top right, 0.5in from the
top, from page 2. There is no layout code in the PDF writer: where a line goes
is the engine's answer, and `test/screenplay-pdf.test.ts` reads the drawn
operators back and compares them with the engine's pages, and checks the PDF's
page count against `estimatePages`. Inline marks come from
`styledBlocksFromHtml`: each row is cut where its marks change and drawn in
Courier, Courier-Bold, Courier-Oblique or Courier-BoldOblique, with a rule under
underlined runs. Right-aligned rows (transitions) are placed by their drawn
width.

`GET /api/export/:id?format=pdf` returns this for a screenplay and the book PDF
for everything else; `format=fountain` is screenplays only. Courier is WinAnsi:
Latin text, which covers English and Spanish. A script mostly in another writing
system, taken whole (`scriptHtmlSupported`), is refused with a 422 that says script formatting
is only available in English and Spanish for now.

Cost: a 124 page script (about 60 000 words) builds in 0.12 to 0.19 s end to end
(request, building the script, laying it out, drawing, serialising) in local
workerd, and the file is 170 KB, against 0.4 to 0.5 s for the book PDF of the
same length. That is wall time in `wrangler dev`: workerd's clock does not advance
inside synchronous work, so there is no in-isolate CPU reading; measure the
deployed Worker before relying on a number.

### Fountain

`src/lib/fountain.ts` is pure and web / server only (the phone sends the file
through the server, so it has no mirror). Writing (`fountainFromScript`):

- capitals are derived at the edge for scene headings, cues, transitions and
  shots; stored text is not changed;
- a forced marker is added where the plain line would be read as another
  element: `.` for a heading with no INT./EXT., `@` for a cue that is not plain
  capitals (or has no dialogue under it), `>` for a transition that does not end
  in `TO:`, and `!` for an action line that looks like a heading, a transition,
  a marker, or (when it is in capitals with another line under it) a cue;
- a shot has no Fountain element: it is `!` plus an all-caps line, and the
  reader makes an all-caps action that begins with a camera direction
  (`isShotLine`) a shot;
- two blocks of dialogue in one speech are separated by a line of two spaces,
  which Fountain keeps; a parenthetical or dialogue with no cue above it is
  written as an action line, because Fountain cannot say otherwise;
- bold is `**`, italic `*`, both `***`, underline `_`, with the delimiters hugging
  the words and `*` / `_` escaped;
- more than one sequence is written as `# ` sections; one sequence is written
  bare; a title block carries the title and author.

Reading (`scriptFromFountain`) honours the forced markers, strips scene numbers
(`#1A#`) and the `^` of dual dialogue (which Ciciro has no element for yet),
drops notes, the boneyard, synopses, page breaks and the title page past its
title and author, reads centered text as action, and splits sequences at the
shallowest `#` depth in the file (one sequence when there are none; text ahead
of the first section is a sequence of its own). `titlePage: false` is for pasted
text, where a first line such as `Notes: ...` is a line, not a title block.
Heading and transition detection follow the spec (a single-line paragraph),
which is also what fountain-js does; `fountain-js` is a devDependency used only
as a test oracle (`test/fountain.test.ts` compares the elements it sees in a
generated 30 page script with the ones written).

`src/lib/import/fountain.ts` turns it into an import (`.fountain`, `.spmd`):
the manuscript is created as a screenplay (`ImportedManuscript.kind`), untitled
sequences are called Sequence N, and appended to a manuscript that is not a
screenplay the `data-sp` attributes are dropped. In the web editor, the
`screenplayPaste` plugin reads pasted text with a blank line in it as Fountain
(`looksLikeFountain`) and other pasted lines with `classifyScreenplayLines`.

The web editor has no underline mark, so underlined text from an import or the
phone is kept in the saved HTML but not shown underlined on the web.

### Script languages

Script formatting is built for English and Spanish (`SCRIPT_LANGUAGES`).
Where a control cannot work in another language it is grayed out with an info
button (web `ExportMenu`'s `.export-info`, phone `ScriptLanguageInfo` on the
`InfoBubble`) saying so and that more languages are planned:

- the screenplay PDF, when the script's own text is in another writing
  system, whatever the app's language. The server, the web `ExportMenu` and the
  phone `ExportCard` all ask one function, `scriptHtmlSupported` (the script
  taken whole: its live sequences joined, archived ones and pending
  suggestions left out, the way the export reads it), so a button that is
  enabled never meets the server's 422;
- choosing Screenplay when creating a manuscript or in the onboarding quiz, on
  the phone, when the app language is Chinese or Hindi
  (`useScriptLanguageSupported`).

VoiceOver reads a phone card as one element, so a grayed-out control also
carries the `screenplay.languageInfo.body` text in its accessibility hint.

Fountain export, the element bar, and an existing script stay available. The
strings are `screenplay.languageInfo.*` in all four locales.

## The web editor

- **Locked type.** `.ProseMirror.screenplay` is 12pt Courier Prime
  (the self-hosted `@font-face` in `globals.css`, which the browser fetches only
  when a script is on the page; there is no `next/font` copy), a
  `60ch` column, line height 1.2, and every indent and width in `ch`, every gap
  in `lh`. The editor font and size settings do not apply to a script. A column
  narrower than the page scales the whole page down together
  (`--screenplay-size`, set by a `ResizeObserver` in `Editor.tsx`), so the lines
  still break where the page breaks them.
- **Soft page breaks.** `ScreenplayPages` (`src/lib/tiptap-screenplay-pages.ts`)
  is a ProseMirror decoration plugin: a dashed rule and the next page's number
  (outside the column) where `paginate()` says a page begins, inside a block at
  the right line when a long action or speech breaks. It takes no height, is never
  saved, and starts from the page the sequence begins on (`pageStart`, from
  `sequenceCursors`).
- **About N pages.** The header meta line shows it from the whole script's
  sequences, so it moves with every keystroke.
- **Element bar and shortcuts.** One button per element (Shot included), with
  its shortcut in the tooltip. **Alt+Shift+1 to 7** choose Scene heading,
  Action, Character, Parenthetical, Dialogue, Shot and Transition (the order
  Arc Studio uses for Cmd+1 to 7). Not Cmd/Ctrl+1 to 9: browsers keep those for
  switching tabs. Not Ctrl+Alt: that is AltGr on many Windows layouts.
  `SHORTCUT_ORDER` in `screenplay.ts` is the source; the Settings reference reads
  from it.

## The assistant

The assistant reads and writes a script as **marked lines**, not as HTML and not
as bare text. Everything is in `src/lib/manuscript-kind.ts` (the contract and
its parser), `src/lib/script-view.ts` (the model view) and `src/lib/passages.ts`
(the scene index).

### The marks

The format is Fountain's forced-element markers, plus `^` for a shot
(`SCRIPT_FORMAT`, which the screenplay directives and the drafter's system prompt
both carry; `ELEMENT_MARK` maps an element to its mark):

| Line | Element |
|---|---|
| `.INT. KITCHEN - NIGHT` | scene heading |
| `!BOOM.` | action (the mark keeps an ALL-CAPS action line from reading as a cue) |
| `@MARA`, `@MARA (V.O.)` | character |
| `(quietly)` | parenthetical, in brackets |
| `He never called.` | dialogue: unmarked, directly under a cue or a parenthetical |
| `>CUT TO:` | transition |
| `^CLOSE ON THE KNIFE` | shot |

A blank line ends a speech. `markedLine(raw)` reads one line (a `.` needs a
letter after it, so an ellipsis is not a scene heading; `> text <` is centered
text and reads as action); `parseScriptLines(text, after?)` reads a whole reply.

**Strict mode.** Once any line in the reply carries a mark, an unmarked line
inside a speech is dialogue or a parenthetical, never a guessed cue, and runs of
unmarked lines outside a speech go through the old classifier. With no marks at
all, `parseScriptLines` is `classifyScreenplayLines(text, after)`, so a model that
ignores the contract still lands sorted into elements. `after` is the element the
text lands under (the editor's block above the caret, the last block of the
chapter), so a bare line after a cue is that cue's dialogue.

`scriptDisplayText(text)` strips the marks again for anything the author reads
(the chat draft card, Copy and Share, the auto-draft's streamed prose and word
counts). The editor's insert still takes the raw draft, because it needs the
marks.

### What the model sees

- `scriptTextOfHtml(html)` writes a chapter as marked lines, as stored (no
  upper-casing: capitals are applied when a page is drawn, so the model's finds
  match the stored words), a blank line between blocks and none inside a speech.
  `read_chapter` and the editor's chapter context use it for a screenplay;
  every other kind is unchanged.
- **Scenes are the passages.** `indexChapter` starts a passage at each scene
  heading when the chapter has any, so `chN.sK` is a scene and `list_passages`
  names it by its heading (`(untitled scene)` for an empty one). A chapter with
  no scene heading falls back to the paragraph-based split.
- `edit_manuscript` replaces a run of blocks with the parsed elements when the
  replacement is multi-line or carries any mark; a replaced shot or unknown tag
  still survives on the first line (see Forward compatibility). A find is
  matched as written. `scriptEdit` (`src/lib/script-edits.ts`, shared by the
  direct and the suggestion paths) strips the marks from a replace for part of a
  line, so a mark is never stored as text, and the brackets from one for a whole
  parenthetical, which is stored bare. A parenthetical's brackets are for
  reading only, so the directive, the tool's `find` description and the
  NOT FOUND note for a bracketed find (`bracketedFindHint`) all say to leave
  them out.

### Auto-draft

`runAutoWrite` gives the drafter the last ten elements as marked lines
(`scriptTail`) and parses each beat with `after = lastScriptElement(chapter so
far)`, so beat two continues from the element beat one ended on. The drafter's
system prompt asks for marked lines, and the editing pass sees the same view.

### Page counts in lists

`pages` on a project in the library and in folders is derived on read for
screenplays only (`src/lib/script-pages.ts`, chunked by 50 for D1's parameter
limit), from the same `estimatePages` as the editor. It is never stored, so
there is no schema change; a script with nothing typed has none. Reading every
sequence's HTML for a list is the cost. If it ever shows up, denormalize onto
`Project` (a D1 upgrade, see `docs/hosting.md`).

## The phone

The phone edits plain lines in the native view (see `AGENTS.md`, "Patched
native editor"). It mirrors the engine, keeps an unknown element through every
flush, and carries the Beta mark.

- **Element bar.** One chip per element, Shot included, and a Tab button that
  follows the same ring. The bar sits just above the keyboard (it used to hang
  under the header), where the thumb is, and above the format bar when that is
  also an accessory. The native view cannot carry `data-sp`, so the tag is
  re-stamped on flush (`restampCiciroHtml`); a new line takes
  `nextElementOnEnter` of the line above.
- **The chip is never a flush behind.** The committed blocks lag the native text
  by up to a second (`REPLACE_FLUSH_MS`), so the lit chip is computed from the
  live text and the caret (`elementTagAtCaret` in `lib/screenplay-live.ts`),
  kept in `manuscript.tsx` as `caretElement`, recomputed on every text change,
  caret move and committed change, and set straight away when a chip is tapped.
  It applies the flush's own rule (`predictElementTags` calls `assignIds`, the
  matcher `restampCiciroHtml` uses, and `test/screenplay-live.test.ts` compares
  the two), so the flush only confirms it. One quirk of the native view is
  modelled: its HTML leaves out one trailing blank line (`X\n` reads back as
  `X`), so the blank Return adds at the end is not in the chapter until
  something is typed into it. Choosing an element for that line therefore gives
  it a block of its own (`appendEmptyBlockOps`), and any other time the target
  is found from the caret in the chapter as just flushed (`elementTargetId`),
  never from the block id of the last caret move, which names the line above.
  The bar scrolls the lit chip to the middle when it is out of view, and leaves
  the row still otherwise, so a chip does not move under a thumb.
- **Page view.** The Pages tile on the chapters screen opens
  `app/project/[id]/pages.tsx`: the script as read-only sheets, 54 lines of 60
  columns in JetBrains Mono (0.6 em wide, like Courier), page numbers from
  page 2, "about N pages" and the Beta mark in the header. It opens on the first
  page of the sequence you were in. The lines and the page breaks come from the
  mirrored engine (`lib/script-pages.ts` stitches `layoutHtml` + `paginate`
  across sequences; there is no second layout function), and a sheet scales to
  the screen (`sheetMetrics`), which is exact because every glyph is the same
  width. This is the report's option M4; typing in a native script layout is
  phase 4.
- **Page counts.** The manuscripts list row and the manuscript meta line say
  "about N pages" (from the server's `pages`), and the chapters screen counts
  them from the loaded sequences, in place of the word count in its kicker (a
  script is measured in pages; each card keeps its words).
- **Chat.** A script draft in the chat card is set as a script
  (`components/ScriptDraft.tsx`: element indents as fractions of the card, caps,
  blank-line spacing; the card is not 60 columns wide, so it wraps and the page
  view is where a script is exact). Insert parses the marked lines (and the
  element above the caret) into elements; Share sends the text without marks.

## Beta

Mark screenplay formatting Beta wherever the author meets it. Today: the kind
picker (web `Library.tsx`, phone `NewManuscriptForm` and the onboarding goal
screen), the element bar (web and phone) and the Settings section. Web uses
`BetaBadge` (`src/components/BetaBadge.tsx`, English only: the web has no
locales); the phone uses `components/BetaBadge.tsx` with `screenplay.beta` and
`screenplay.betaInfo` in all four locales. The export entries (Screenplay PDF and Fountain) carry it too. When screenplay leaves Beta, remove the badges and the
`betaInfo` string.

## Manuscript settings

A section at the top of Settings that exists only while a manuscript is open,
and only shows the settings for that manuscript's kind.

- `hasKindSettings(kind)` in `manuscript-kind.ts` (mirrored) says which kinds
  have a section. Only `screenplay` does.
- **Web.** `ThemePicker` takes the open manuscript's `kind` (the workspace
  passes it; the library does not). `ManuscriptSettings` renders the section
  first, ahead of the themes. For a screenplay it is the locked type (12 pt
  Courier Prime, and the generic Type and Size rows below are disabled with a
  note) and a collapsible reference of every element shortcut.
- **Phone.** The manuscript tab bar's Settings action opens `/settings` with
  the manuscript's id (`?project=`), and `app/settings.tsx` reads the kind from
  the project query. For a screenplay it shows the locked format, a note that
  the page layout shows on the web for now, and how the element bar, Tab and
  Return behave (the phone has no hardware shortcuts). Opened from the library,
  there is no section.
- **Adding a setting.** Add a row to that kind's component (`ScreenplaySettings`
  on the web, `ScreenplaySettingsGroup` on the phone). Phase 3's `(MORE)` and
  `(CONT'D)` switches, scene numbers and the title page go there.
- **Storage.** Nothing is persisted yet. No per-manuscript settings store
  exists today (`Project` has no settings column and `ManuscriptTarget` is the
  deadline). A phase-3 toggle must not need a D1 change; the options without one
  are a `BibleFile` (the `style.md` em-dash switch is the precedent) or a
  per-user setting keyed by project in the existing settings JSON. Decide there.

## Not here yet

Belongs to later phases: autocomplete, smart Tab, typed-input capitals and the
scene navigator (phase 2); the title page, `(MORE)`/`(CONT'D)`, dual dialogue,
centered text and FDX import and export (phase 3); a native phone writing
surface that lays the page out while you type (phase 4).

Smaller follow-ups: a find on the capitals elements is case sensitive, since the
text is stored as typed; the assistant has no page awareness or page target yet
(only the minute-a-page rule of thumb); the page counts for lists could be
denormalized; the chat draft card is not an exact page; the page view has no
analytics events.
