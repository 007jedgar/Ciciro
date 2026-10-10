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
| Centered | `centered` | 7th |

Tab walks that ring and Shift-Tab walks it back, except where Tab means more
(see Writing speed). Enter starts the element that usually follows
(`nextElementOnEnter`). A shot behaves like a scene heading
for layout and for Enter (the next line is action), is set in capitals, and is
not bold. Centered text (a title card, THE END) is action set across the page:
Enter after it starts action.

One more flag lives on a block besides its element: `data-sp-dual="1"` on a
character cue means that cue's speech sits **beside** the speech right above it
(dual dialogue). It is stored like the element, read with `dualOfHtml` and
written with `withDual`, and `withElement` drops it when a block stops being a
cue. Both clients carry it through every rewrite: the web's `screenplayDual`
attribute, and the phone's `restampCiciroHtml` (which strips it from the HTML
the native view sees and puts it back from the matching old block).

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
  a replaced shot, centered line or unknown tag stays on the replacement's first line
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
- `wrapText`, `layoutBlock`, `layout`: set blocks on the page, line by line,
  with dual-dialogue pairs (`dualPairs`, `DUAL_METRICS`) set as two columns;
- `paginate`, `typeset`, `pagesAsText`: break laid-out blocks into pages, with
  `(MORE)` and the repeated `NAME (CONT'D)` cue as rows of their own
  (`PageOptions`: `more`, `contd`, `sceneNumbers`);
- `scriptBlocksFromHtml`, `layoutHtml`, `sequenceCursors`, `estimatePages`:
  from chapter HTML to a page count, and where each sequence's scene numbers
  start;
- `scenes`, `dialogueGroups` and `speechAt`: structure derived from the flat
  blocks (`speechAt` is what the dual-dialogue control asks, on both clients);
- the script settings: `ScriptSettings`, `TitlePage`, `parseScriptSettings`,
  `serializeScriptSettings`, `resolveTitlePage`, `pageOptionsOf` and the
  limits on each field;
- `styledBlocksFromHtml` (blocks with their bold / italic / underline runs),
  `sliceRuns`, and `typesetSequences` (every sequence set on pages that run on
  from one another, each row knowing its sequence, block and offset): what the
  PDF draws;
- writing speed (below): `capsText`, `smartTab`, `parseCue` / `toggleExtension`,
  `parseSceneHeading`, `buildScriptIndex` / `completionsFor`, `continuesSpeech`,
  `bibleCharacterNames`, and the scene helpers `sceneOutline` / `moveSceneOrder`;
- `SCRIPT_LANGUAGES`, `scriptLanguageSupported(code)`,
  `scriptTextSupported(text)`, `scriptHtmlSupported(chapters)` and
  `scriptPdfSupported(chapters, settings, manuscript)`: which languages script
  formatting covers.

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
| Centered | 0 | 60 | centered across the 60 columns |

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

#### Dual dialogue

A cue flagged `data-sp-dual` pairs its speech with the speech directly above it
(the two touch, with nothing between), through `dualPairs`. A speech joins at
most one pair, so a flag on the speech after a pair's second is ignored, and so
is a flag with nothing right above it. The pair is set as two columns of 28 with
a gap of 4 (`DUAL_METRICS`: the left cue at column 8 and 20 wide, its
parenthetical at 4 and dialogue at 0; the right at 40, 36 and 32), and takes as
many lines as the taller column. A pair is one unit on the page: it never
splits, and a pair taller than a page (52 lines) falls back to two speeches one
after the other.

#### Pagination

`paginate` is exact for a given set of `PageOptions`, and the editor's markers,
the header's page count, the PDF and the golden all call it:

- a scene heading, shot, cue or parenthetical stays on the page with what
  follows it;
- an action or a speech may break across a page only with two lines on each
  side (widow and orphan rule); anything else moves whole;
- a break drops the blank line at the top of the page;
- when a break falls **inside a speech**, the page above ends with `(MORE)`
  (one line, at the cue's column) and the next page opens with the cue again,
  `NAME (CONT'D)`, wrapped at the cue's width, with the rest of the speech
  directly under it. Each takes a line of the page, and each is a setting
  (`more`, `contd`, default on), so turning one off moves where pages end. A
  speech that does not break gets neither, and a cue that already ends in
  `(CONT'D)` is not given a second one (`contdCue`). A dialogue block that is
  not the speech's last never fills a page exactly, so `(MORE)` always has its
  line;
- a speech never leaves a lone cue or a lone parenthetical at the foot of a page
  (the old estimate could; this was a bug in it);
- the numbered scenes (`isNumberedScene`: a scene heading with words in it) are
  counted across sequences, so scene numbers run on.

`(MORE)` and the repeated cue are rows the engine adds (`PageRow.synthetic`),
never part of the saved text. "A page is a minute" is still a rule of thumb.
Not done yet: `(MORE)` / `(CONT'D)` in languages other than English. (The
character's `(CONT'D)` when the same character speaks again after an action line
is typed text, see Extensions and CONT'D below.)

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
- `test/screenplay-professional.test.ts`: centered text, dual dialogue, the
  `(MORE)` / `(CONT'D)` rules and scene numbers, with a second golden:
  `test/fixtures/screenplay/professional.ts` set on the page must equal
  `professional.pages.txt` (`UPDATE_GOLDEN=1`, read the diff).
- `test/screenplay-parity.test.ts`: the two copies are identical.
- `test/screenplay-css.test.ts`: the editor's `ch` numbers equal
  `ELEMENT_METRICS` and `DUAL_METRICS`, each width carries the sub-character
  `--sp-slack` (so a line of exactly that many characters does not wrap early),
  the editor wraps with `pre-wrap` like `wrapText`, and the speech-run selectors
  equal `SPEECH_RUNS`.
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
top, from page 2 of the script. There is no layout code in the PDF writer: where a
line goes is the engine's answer, and `test/screenplay-pdf.test.ts` reads the drawn
operators back and compares them with the engine's pages, and checks the PDF's
page count against `estimatePages`. Inline marks come from
`styledBlocksFromHtml`: each row is cut where its marks change and drawn in
Courier, Courier-Bold, Courier-Oblique or Courier-BoldOblique, with a rule under
underlined runs. Right-aligned rows (transitions) are placed by their drawn
width, centered rows by theirs, a dual-dialogue row draws both of its cells, the
synthetic `(MORE)` and `(CONT'D)` rows are drawn without marks, and with scene
numbers on the number is drawn in both margins of the heading (bold).

**Title page.** When the script's settings ask for it (`showTitlePage`, on by
default) and it has any text (`hasTitlePageText`), the first PDF page is the
title page, not counted in the script's pages and not numbered: the title in
bold capitals 16 lines below the top margin, then credit, author and source
centered, a blank line between them; the contact block lower left (wrapped at
30 columns) and the draft date lower right. A blank title or author is the
manuscript's own and a blank credit is "Written by" once there is an author
(`resolveTitlePage`). The same resolved page is what Fountain and FDX write.

`GET /api/export/:id?format=pdf` returns this for a screenplay and the book PDF
for everything else; `format=fountain` and `format=fdx` are screenplays only.
The route reads the manuscript's `scriptSettings`. Courier is WinAnsi: Latin
text, which covers English and Spanish. A script mostly in another writing
system, or a title page in one (`scriptPdfSupported`, which judges the script and
the title page each on their own, and ignores the PDF's own "Written by"), is
refused with a 422 that says script formatting is only available in English and
Spanish for now. Fountain and FDX are UTF-8 and always export.

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
- dual dialogue is a `^` after the second cue (only for pairs `dualPairs`
  accepts on every block, empty ones included, as the editor and PDF pair them), centered text is `> text <`, and with scene numbers on each heading
  carries `#n#` (counted across sequences);
- more than one sequence is written as `# ` sections; one sequence is written
  bare; a title block carries the title page: `Title`, `Credit`, `Author`,
  `Source`, `Draft date` and `Contact` (its lines indented four spaces).

Reading (`scriptFromFountain`) honours the forced markers, reads the title page
keys above (and `Date` as the draft date) into a `TitlePage`, strips scene
numbers (`#1A#`) and notes that the script had them (so an import can switch
scene numbers on), reads `^` as dual dialogue and `> text <` as centered text,
drops notes, the boneyard, synopses and page breaks, and splits sequences at the
shallowest `#` depth in the file (one sequence when there are none; text ahead
of the first section is a sequence of its own). `titlePage: false` is for pasted
text, where a first line such as `Notes: ...` is a line, not a title block.
Heading and transition detection follow the spec (a single-line paragraph),
which is also what fountain-js does; `fountain-js` is a devDependency used only
as a test oracle (`test/fountain.test.ts` compares the elements it sees in a
generated 30 page script with the ones written).

`src/lib/import/fountain.ts` turns it into an import (`.fountain`, `.spmd`):
the manuscript is created as a screenplay (`ImportedManuscript.kind`) with the
file's title page and scene numbers as its `scriptSettings`
(`ImportedManuscript.script`), untitled sequences are called Sequence N, and
appended to a manuscript the settings are left alone and, for one that is not a
screenplay, the `data-sp` attributes are dropped. In the web editor, the
`screenplayPaste` plugin reads pasted text with a blank line in it as Fountain
(`looksLikeFountain`) and other pasted lines with `classifyScreenplayLines`.

The web editor has no underline mark, so underlined text from an import or the
phone is kept in the saved HTML but not shown underlined on the web.

### FDX

`src/lib/fdx.ts` (pure, web / server only, like Fountain) reads and writes the
XML file Final Draft and several other script writers use. The UI calls it
**FDX export** and says Beta, and nothing in the product or the docs claims
Final Draft compatibility: there is no copy of Final Draft to try a file
against. What stands in for one is open source: the structure follows what
afterwriting's FDX converter, screenplain's exporter and `@draftfirst/core`
agree on, and `test/fdx.test.ts` runs the golden (`test/fixtures/fdx/night-shift.fdx`)
through each of them as an oracle (`@draftfirst/core`, MIT, is a devDependency
for that only; the others are checked-in outputs).

- A `Paragraph` per block, its `Type` the element ("Scene Heading", "Action",
  "Character", "Parenthetical", "Dialogue", "Transition", "Shot"); centered text
  is an Action with `Alignment="Center"`; a parenthetical's text carries its
  brackets; scene numbers are `Number` on the heading.
- `Text` runs with `Style="Bold+Italic+Underline"`.
- Dual dialogue is `<Paragraph><DualDialogue>…</DualDialogue></Paragraph>`
  around the two speeches' paragraphs, paired like Fountain's `^` (an empty
  block between two speeches separates them).
- A `TitlePage` of free paragraphs. FDX has no fields for it, so the reader
  sorts them by alignment and shape (centered groups: title, credit, author,
  source; left: contact; right: date) and the writer emits them in that order.
- It reads with its own small XML parser: iterative with a depth cap of 64, no
  DTD and no entity expansion beyond the five named and numeric ones, so a
  hostile file cannot loop or blow up.

FDX has no sections: a file is one sequence on the way in, and several sequences
are written one after another on the way out (their titles are lost). A script's
FDX export works in any language (it is UTF-8). `.fdx` is wired into import
(`src/lib/import/fdx.ts`, `detectFormat`), the web Library and phone pickers, and
the export route, menu and phone Export card.

### Script languages

Script formatting is built for English and Spanish (`SCRIPT_LANGUAGES`).
Where a control cannot work in another language it is grayed out with an info
button (web `ExportMenu`'s `.export-info`, phone `ScriptLanguageInfo` on the
`InfoBubble`) saying so and that more languages are planned:

- the screenplay PDF, when the script's own text is in another writing
  system, or when the title page it would carry is, whatever the app's language.
  The server, the web `ExportMenu` and the phone `ExportCard` all ask one
  function, `scriptPdfSupported` (the script taken whole: its live sequences
  joined, archived ones and pending suggestions left out, the way the export
  reads it, plus the title page when it is on), so a button that is enabled
  never meets the server's 422;
- choosing Screenplay when creating a manuscript or in the onboarding quiz, on
  the phone, when the app language is Chinese or Hindi
  (`useScriptLanguageSupported`).

VoiceOver reads a phone card as one element, so a grayed-out control also
carries the `screenplay.languageInfo.body` text in its accessibility hint.

Fountain and FDX export, the element bar, and an existing script stay
available. The
strings are `screenplay.languageInfo.*` in all four locales.

## Writing speed

Everything that makes a script faster to write is decided in `screenplay.ts`
(pure, mirrored, `test/screenplay-speed.test.ts`), so the web popup and the
phone's chips offer the same words and Tab does the same thing. The editors only
carry the decision out.

### Capitals as you type

`capsText(element, text)` / `setsCaps(element)` say which elements are set in
capitals (`ELEMENT_METRICS.caps`: scene heading, character, transition, shot).
The web's `screenplayCaps` plugin (`tiptap-screenplay.ts`, `handleTextInput`)
makes what is **typed** into one of them capitals, as Final Draft does; text that
is already there, pasted, imported or written by the assistant is stored as it
was and set in capitals at the edges (the page, the PDF, Fountain, the model
view). The phone cannot intercept a keystroke in the native view, so it opens the
keyboard in capitals instead (`autoCapitalize="characters"` while the caret line
is a caps element, a live prop of the patched view that refocuses without
emitting focus events); a hardware keyboard or predictive text can still type
lowercase there, which the same edges set in capitals. Tab-cycling a line never
rewrites its case.

### Names, places and times (autocomplete)

`buildScriptIndex(sequences, { names })` reads every cue (extensions off) and
every scene heading (`parseSceneHeading`: prefix, location, time of day, split at
the last dash) of the script, most used first and then most recent, and adds the
story bible's characters (`bibleCharacterNames`, from the `GET /api/bible` index:
`characters/<slug>.md` and the first line of the file) after the used names, so a
name completes before its first use. `completionsFor(element, text, index, opts)`
returns what the line may take, for the caret at the end of it:

- a **cue**: names that continue what is typed (a name typed in full comes first,
  so Tab can move on; a name that picks a speech back up is offered as
  `NAME (CONT'D)` first);
- a **scene heading**: `INT.` / `EXT.` / `INT./EXT.`, then the places, then the
  times of day (the script's own, then the defaults for the app's language:
  `timesOfDay("es")` is Spanish). A bare `INT.` offers nothing on the desk, because
  Tab adds the space. A prefix typed without its dot (`INT`, `int/ext`) still
  offers the dotted prefixes, and past it every choice writes the dot in
  (`dottedPrefix`).

On the desk nothing is offered on an empty line (the popup waits for a first
letter, so Tab keeps its ring), and the line being typed is left out of the index
(`suggestionsFor` builds it from the other lines). `ScriptSuggest` is the popup
under the caret (`aria` listbox with a live-region announcement); Tab takes the
highlighted choice, the arrow keys move it, **Enter takes it only after an arrow
key** (otherwise Enter ends the line as always), Esc closes it until the line
changes, and a choice that would change nothing is not taken, so Tab goes on. The
popup is a ProseMirror plugin (`screenplaySuggest`) whose state is derived from the
document and selection on every transaction.

On the phone (`lib/screenplay-speed.ts`, `components/ScriptChips.tsx`) the same
completions are chips just above the element bar, shown for an empty cue or
heading too (`whenEmpty`) and with `trailing: false`: the chapter's text drops a
trailing space whenever it is committed, so a phone choice never ends in one
(`INT.`, `INT. LAB -`, then `INT. LAB - NIGHT`) and the next choice supplies the
space. A chip splices the rest of the line through the same
`getHTML` / `setValue` / `setSelection` path as the synonym swap
(`replaceLineTail` in `selection-edit.ts`).

### Tab

`smartTab(element, text)` (the caret at the end of the line):

| Line | Tab does |
|---|---|
| `INT.` | adds the space: on to the location |
| `INT. LAB` | adds ` - `: on to the time of day |
| `INT. LAB - NIGHT` | starts an action line under it |
| a cue with a name | starts a parenthetical on a new line |
| anything else | the ring of elements |

A heading whose prefix lacks its dot (`INT LAB`) gets it on the way: the flow is
`replace`, the whole line rewritten with the dot plus what Tab would add. A
finished dotless heading (`INT LAB - NIGHT`) is left as typed.

The popup's choice wins over all of these. The phone's Tab button asks the same
function (`trailing: false`: a bare `INT.` is a quiet no-op, because the chips
already show the places) and starts the new line with `insertLineAfter`, then sets
its element like a chip tap.

### Extensions and CONT'D

`CUE_EXTENSIONS` (`V.O.`, `O.S.`, `CONT'D`) are written in brackets after the
name, which is also how Fountain and the assistant's `@NAME (V.O.)` carry them.
`toggleExtension` adds or removes one (V.O. and O.S. replace one another, CONT'D
goes last, a cue with no name is left alone); the web's bar buttons
(`toggleCueExtension`) and the phone's chips use it. `continuesSpeech(blocks,
index, name)` says whether the same character spoke last in the scene with
non-empty action in between. **Automatic CONT'D** is stored text, not derived: the
web adds ` (CONT'D)` when Enter ends such a cue, and both clients offer
`NAME (CONT'D)` first in the choices. It is a plain extension, so removing it with
the button sticks until Enter is pressed on that cue again. The extension buttons
are English abbreviations and are grayed out, with an info button, for a script
in a language script formatting does not cover (web `scriptHtmlSupported` on the
open sequence, phone `scriptLanguageSupported`); the same check skips the
automatic CONT'D on Enter and leaves `NAME (CONT'D)` out of the choices (web
`ScriptContext.extensions`, phone `chipsForLine`). It is independent of the
page-break `(CONT'D)` setting (which only governs the derived repeat of a cue at
the top of the next page): a cue that already ends in `(CONT'D)` is not given a
second one there (`contdCue`), so the two never double up.

### Scenes

`sceneOutline(blocks, start)` lists a run of blocks' scenes (`scenes()`: a
heading to the next) with the heading as the page sets it and the page it begins
on (from `paginate`, so it is the page the editor and the PDF count).
`moveSceneOrder(blocks, from, to)` is the permutation that moves a scene to where
another is; blocks ahead of the first heading (the lead-in) stay put. Scenes are
addressed by their index in `scenes()`, never by block index, so the navigator
(derived from the saved HTML) and the editor (derived from its own document)
agree even when a block is not a paragraph.

- **Web.** The **Scenes** button (screenplays only) opens `SceneNavigator`: every
  sequence's scenes with their pages, a click jumps (`Editor.revealScene`, queued
  through `heldWrites` when it is another sequence), and the arrows move a scene
  within the open sequence (`moveScene` in `tiptap-screenplay.ts`: one
  transaction over the span of blocks whose place changes, every node, with its
  block id, kept).
- **Phone.** The **Scenes** tile on the chapters screen
  (`app/project/[id]/scenes.tsx`) lists every sequence's scenes; a tap opens the
  manuscript at the scene (`recordReadingPosition`, as search does), and the
  arrows move a scene within its sequence (`moveSceneOps`: the blocks whose place
  changes are deleted and set down again in the new order, as one op group, so a
  move lands whole; they get new block ids, so a comment anchored to one of them
  is orphaned).

## The web editor

- **Locked type.** `.ProseMirror.screenplay` is 12pt Courier Prime
  (the self-hosted `@font-face` in `globals.css`, which the browser fetches only
  when a script is on the page; there is no `next/font` copy), a
  `60ch` column, line height 1.2, and every indent and width in `ch`, every gap
  in `lh`. The editor font and size settings do not apply to a script. A column
  narrower than the page scales the whole page down together
  (`--screenplay-size`, set by a `ResizeObserver` in `Editor.tsx`), so the lines
  still break where the page breaks them.
- **Page markers and dialogue breaks.** `ScreenplayPages`
  (`src/lib/tiptap-screenplay-pages.ts`) is a ProseMirror decoration plugin: a
  dashed rule and the next page's number (outside the column) where `paginate()`
  says a page begins, inside a block at the right line when a long action or
  speech breaks, and, when the break is inside a speech, `(MORE)` above the rule
  and the cue with `(CONT'D)` below it, set in the columns they print in. Nothing
  takes height, nothing is saved, and the plugin starts from the page the
  sequence begins on (`start`, from `sequenceCursors`). Its `settings` option
  (`more`, `contd`, `sceneNumbers`, `scenesBefore`) comes from the manuscript's
  script settings.
- **Dual dialogue and scene numbers.** The same plugin adds classes to the two
  speeches of a pair (`sp-dual sp-dual-left` / `sp-dual-right`, with first / last
  and a flush class at the top of a page), which `globals.css` turns into two
  columns (the left floats, the right is normal flow beside it, the block after
  the pair clears both), and a `data-scene-number` on each numbered heading that
  the CSS draws in both margins. `test/screenplay-css.test.ts` keeps the `ch`
  numbers equal to `DUAL_METRICS` and the element metrics.
- **N pages.** The header meta line shows the exact count of the whole script's
  sequences (the title page is not counted), so it moves with every keystroke.
- **Element bar and shortcuts.** One button per element (Shot and Centered
  included), with its shortcut in the tooltip, and a Dual button that seats the
  speech under the caret beside the one above (or takes it back). **Alt+Shift+1
  to 8** choose Scene heading, Action, Character, Parenthetical, Dialogue, Shot,
  Transition and Centered (the order Arc Studio uses for Cmd+1 to 7, with
  Centered added); **Alt+Shift+D** toggles dual dialogue (`toggleDual`, over
  `speechAt`). Not Cmd/Ctrl+1 to 9: browsers keep those for switching tabs. Not
  Ctrl+Alt: that is AltGr on many Windows layouts. `SHORTCUT_ORDER` in
  `screenplay.ts` is the source; the Settings reference reads from it.

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
| `>THE END<` | centered text |

A blank line ends a speech. `markedLine(raw)` reads one line (a `.` needs a
letter after it, so an ellipsis is not a scene heading; `> text <` is centered
text); `parseScriptLines(text, after?)` reads a whole reply.

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
limit), from the same `estimatePages` as the editor, under that project's own
`scriptSettings` (`(MORE)` and `(CONT'D)` take lines of the page, so a list says
the number the editor does). It is never stored, so
there is no schema change; a script with nothing typed has none. Reading every
sequence's HTML for a list is the cost. If it ever shows up, denormalize onto
`Project` (a D1 upgrade, see `docs/hosting.md`).

## The phone

The phone edits in the native view (see `AGENTS.md`, "Patched native editor"). By
default it edits plain lines and the layout is the Pages tile's; on iOS an
author can switch on the page layout, which sets the lines in the editor as they
are typed ([Writing in the page layout](#writing-in-the-page-layout-ios-beta)).
Either way it mirrors the engine, keeps an unknown element and the dual
flag through every flush,
and carries the Beta mark.

- **Element bar.** One chip per element, Shot and Centered included, and a Tab button that
  follows the same ring. The bar sits just above the keyboard (it used to hang
  under the header), where the thumb is, and above the format bar when that is
  also an accessory. Without the page layout the native view cannot carry
  `data-sp`, so the tag is re-stamped on flush (`restampCiciroHtml`); a new line
  takes `nextElementOnEnter` of the line above. With it, the native view carries
  the tag and the chip drives it (below).
- **The chip is never a flush behind** (page layout off; with it on the editor
  reports the element under the caret itself). The committed blocks lag the native text
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
- **Dual.** The bar has a Dual chip that is grayed out unless the caret is in a
  speech with another right above it, or already beside one; it writes the flag
  on the speech's cue with `toggleDualOps` (`apps/mobile/lib/block-editor.ts`).
  The settings, the title page and every export come from the server, which
  sets them with the same engine.
- **Page view.** The Pages tile on the chapters screen opens
  `app/project/[id]/pages.tsx`: the script as read-only sheets, 54 lines of 60
  columns in JetBrains Mono (0.6 em wide, like Courier), page numbers from
  page 2, "N pages" and the Beta mark in the header. It opens on the first
  page of the sequence you were in. The rows come from the mirrored engine's
  `typesetSequences`, the same typeset the PDF draws (`lib/script-pages.ts` sets
  each row as one monospace line and gives the sequences' starts; there is no
  second layout function), under the script's own settings
  (`pageOptionsOf(parseScriptSettings(project.scriptSettings))`). So a sheet
  shows what the PDF does: a dual-dialogue row has both columns on its line (the
  right at its own column, via the engine's `cellPad`), a speech that runs past
  the page closes it with `(MORE)` and opens the next with the cue and
  `(CONT'D)`, centered text is centered, and with scene numbers on a heading
  carries its number in both margins (`sheetMetrics(width, NUMBER_GUTTER)` keeps
  four columns on each side, so the type is a little smaller then). A sheet
  scales to the screen (`sheetMetrics`), which is exact because every glyph is
  the same width. This is the report's option M4; the editor's own page layout
  is below.
- **Page counts.** The manuscripts list row and the manuscript meta line say
  "N pages" (from the server's `pages`), and the chapters screen counts them
  from the loaded sequences and the same settings, in place of the word count in
  its kicker (a script is measured in pages; each card keeps its words).
- **Chat.** A script draft in the chat card is set as a script
  (`components/ScriptDraft.tsx`: element indents as fractions of the card, caps,
  blank-line spacing; the card is not 60 columns wide, so it wraps and the page
  view is where a script is exact). Insert parses the marked lines (and the
  element above the caret) into elements; Share sends the text without marks.

### Writing in the page layout (iOS, Beta)

Phase 4. A switch in the screenplay's Settings section, **Page layout while
typing**, sets the script in the editor as it is typed: the type is the page's
(a monospace face sized so 60 columns fill the screen, `scriptEditorMetrics`),
each element sits at its indent and width (a cue, parenthetical and dialogue as
a run with no blank lines between, a transition against the right edge), a Return
starts what the engine says follows, and the keyboard types capitals where the
element is capitals (scene heading, cue, transition). Off by default and on
this phone only: it is a local pref (`lib/script-layout.ts`, key `script-layout`,
like focus mode), so it never syncs and is not stored on the manuscript. It is
iOS only (`scriptLayoutSupported()`; the row is not shown on Android), grayed
with the info button in a language script formatting does not cover, and under
the section's Beta mark. `manuscript.tsx` turns it into `nativeScript` (a
screenplay, the switch on, a supported language) and `ChapterEditor` takes it as
`scriptLayout`.

**The native side** is a patch to `react-native-enriched-html`
(`apps/mobile/patches/`, see `AGENTS.md`): a screenplay paragraph style,
`ios/styles/ScreenplayStyle.mm`, next to `AlignmentStyle` and carried the same
way, as a marker (`EnrichedScreenplay:<tag>`) in the paragraph's
`NSParagraphStyle.textLists`. It is inert until the app sends the `screenplay`
prop, a JSON page (`screenplayLayoutConfig()`): `PAGE_COLUMNS`, each element's
`ELEMENT_METRICS` (indent, width, alignment, capitals), `nextElementOnEnter` and
`SPEECH_RUNS`. Every number comes from the shared engine, so the editor holds no
page rules of its own (`__tests__/script-layout.test.ts` compares them). A
paragraph's indents, alignment and the space after it are written into its
paragraph style (`firstLineHeadIndent`, `headIndent`, a negative `tailIndent`
from the trailing edge, a blank line as `paragraphSpacing`, none inside a speech
run); a column is the advance of "0" in the typing font. Left alignment stays
natural, so the HTML never grows a `text-align` it did not have.

- **The HTML round trip keeps `data-sp` exactly.** `<p data-sp="tag">` parses to
  the marker and serializes back (action, the default, writes none), so
  `toEnrichedHtml(html, { elements: true })` hands the tags in and `getHTML()`
  returns them; `restampCiciroHtml(..., { nativeElements: true })` takes each
  block's tag from what the editor reported, new blocks included (the editor has
  already applied Return), and `opsFromEnrichedHtml` diffs on that. The library's
  Gumbo normalizer drops attributes it does not know, so
  `cpp/parser/GumboNormalizer.c` lets `data-sp` through on a `<p>` (slug
  `[A-Za-z0-9][A-Za-z0-9_-]{0,31}`). A tag a newer client wrote and this build
  cannot lay out (`dual-future`) is laid out as action and written back as it was
  read, never rewritten; so is an empty line's tag (`<p data-sp="character"></p>`).
  The same rule as everywhere: store the tag, not the collapsed element.
- **Return follows the web editor** (`tiptap-screenplay.ts`): Return on an empty
  line that is not action drops back to action (no new line, and the app is told,
  so it saves), a Return that splits dialogue leaves dialogue on both sides, and
  any other Return starts `nextElementOnEnter` of the line it ends or splits.
- **The keyboard follows the element** without a remount: the native view sets
  `autocapitalizationType` to all characters on a capitals element and back to
  what the app asked for elsewhere, then reloads the input views. The chip
  (`setScreenplayElement`) retags the paragraph(s) under the caret or selection,
  and `onChangeState.screenplay` reports the element under the caret, which is
  what lights the chip in this mode (`recomputeElement` is only for the plain
  editor).
- **Capitals are typed, not derived.** The editor never uppercases text already
  on the page: a script written lowercase (the assistant's older output, a
  Fountain import) shows as it is stored, and the page view, the PDF and Fountain
  set the capitals elements in capitals at the edges, as they always have.
- **A layout change in flight remounts the view.** `ChapterEditor` waits to mount
  until it has a width (so the first layout is the page's) and keys the native
  view on the chapter and the mode, so switching the layout in Settings gives a
  fresh view with the right HTML; `registerEditor` re-registers.

**Needs a new native build.** The native module changed, so none of this reaches
a phone through an over-the-air update: `patches/` is part of the Expo
fingerprint, so a JS update that depends on it only goes to builds that contain
it, and until a build ships the row in Settings does not exist. Android is not
done: the Kotlin view manager accepts the `screenplay` prop and the
`setScreenplayElement` command and ignores them (the codegen interface needs
both, and the checked-in generated files mirror them), and the app never sends
them there. It is a follow-up, with the same shape as the iOS style.

**Spike findings** (iPhone 17e simulator, against a local server): the round trip
is exact for the seven elements, an unknown tag, inline marks (`<strong>` inside
dialogue came back identical, block ids unchanged), empty lines mid-document and a
new empty script; a typed line commits as a block with the editor's tag;
retagging by chip, Return at the end and in the middle of a line (a cue split
mid-word, dialogue split mid-sentence), and Return on an empty line all commit
what the web would; the keyboard went to
capitals on a scene heading, a cue, and a line chosen as a cue, and back after
Return. A 1,200-block (90 KB) script laid out about 1.5 seconds after opening and
typed no slower than the plain editor. Known limits: the monospace face has no
bold, so inline bold in a script is stored but does not show (the native view logs
"Couldn't apply bold trait"); no brackets are drawn round a parenthetical, as the
text is stored with them; `getHTML()` still leaves out one trailing blank line (as
in the plain editor); and the face is JetBrains Mono, the same 0.6 em advance as
Courier Prime that the page view uses, not Courier Prime itself.

**Tests.** `__tests__/enriched-html.test.ts` (tags in and out, ids, unknown tags,
retagging, empty lines), `__tests__/script-layout.test.ts` (the page config
against the engine, the type metrics, the switch), `__tests__/ChapterEditor.test.tsx`
(waits for width, passes the page, remounts on a switch, the echo check) and
`__tests__/settings-manuscript.test.tsx` (the switch, Android, a language it
cannot serve). The native half has no automated test; the checks above were run
by hand on a simulator. To check the normalizer passthrough without a device,
compile `cpp/parser/GumboNormalizer.c` with a small driver and feed it
`<p data-sp="character">MARA</p>`.

## Beta

Mark screenplay formatting Beta wherever the author meets it. Today: the kind
picker (web `Library.tsx`, phone `NewManuscriptForm` and the onboarding goal
screen), the element bar (web and phone) and the Settings section (the page
layout switch sits under its mark). Web uses
`BetaBadge` (`src/components/BetaBadge.tsx`, English only: the web has no
locales); the phone uses `components/BetaBadge.tsx` with `screenplay.beta` and
`screenplay.betaInfo` in all four locales. The export entries (Screenplay PDF, Fountain and FDX export) carry it too. When screenplay leaves Beta, remove the badges and the
`betaInfo` string.

## Manuscript settings

A section at the top of Settings that exists only while a manuscript is open,
and only shows the settings for that manuscript's kind.

- `hasKindSettings(kind)` in `manuscript-kind.ts` (mirrored) says which kinds
  have a section. Only `screenplay` does.
- **Web.** `ThemePicker` takes the open manuscript's `kind` and its script
  settings (the workspace passes them; the library does not). `ManuscriptSettings`
  renders the section first, ahead of the themes. For a screenplay it is the
  locked type (12 pt Courier Prime, and the generic Type and Size rows below are
  disabled with a note), switches for `(MORE)`, `(CONT'D)` and scene numbers, the
  **Title page** (title, credit, author, source, draft date, contact, and
  whether the PDF carries it), and a collapsible reference of every element
  shortcut. A change shows at once (the page markers redraw) and is saved
  after a short pause with a project PATCH (`createScriptSettingsSaver` in
  `src/lib/script-settings-save.ts`). A refused save puts the editor back to
  the stored settings and says so in a snackbar; a waiting save is sent before
  an export (`ExportMenu`'s `beforeExport`) and, with `keepalive`, when the page
  goes away.
- **Phone.** The manuscript tab bar's Settings action opens `/settings` with
  the manuscript's id (`?project=`), and `app/settings.tsx` reads the kind and
  settings from the project query. For a screenplay it shows the locked format,
  the iOS-only **Page layout while typing** switch, the same three switches and "Title page in the PDF" (`useScriptSettings`, a
  project PATCH with the change shown at once and put back on failure), the six
  title page fields behind a Save button (`TitlePageFields`), and how the
  element bar, Dual, Tab and Return behave. Opened from the library, there is no
  section.
- **Storage.** One column, `Project.scriptSettings`: a JSON string, `""` meaning
  every default (`prisma/d1-script-settings.sql`, see `docs/hosting.md`). The
  engine owns the shape (`ScriptSettings`: `titlePage`, `showTitlePage`, `more`,
  `contd`, `sceneNumbers`) and tidies it (`parseScriptSettings`, which is
  forgiving of anything missing or newer, and `serializeScriptSettings`, which
  writes `""` when everything is at its default). `PATCH /api/projects/:id`
  accepts `scriptSettings` for a screenplay only, normalizes it and so bounds
  every field (`TITLE_PAGE_LIMITS`). A screenplay import sets it from the
  file; the data export includes the column and deleting the account removes it
  with the manuscript. The next setting needs no migration: add a key to
  `ScriptSettings` and its default.
- **Adding a setting.** Add a row to that kind's component (`ScreenplaySettings`
  on the web, `ScriptSettingsRows` on the phone) and a key in `ScriptSettings`;
  if it shapes pages, add it to `PageOptions` so the editor, count, PDF and
  golden all see it.

## Not here yet

Never planned here: revision colours, A-pages and locked pages,
and any claim of Final Draft compatibility.

Phase 4 follow-ups: the page layout on Android (the Kotlin view manager ignores
the prop today); the layout on for every author once Beta ends (it is a switch,
off by default, today); bold in a script face that has one.

Smaller follow-ups: a find on the capitals elements is case sensitive, since the
text is stored as typed; the assistant has no page awareness or page target yet
(only the minute-a-page rule of thumb); the page counts for lists could be
denormalized; the chat draft card is not an exact page; the page view has no
analytics events; the phone has no automatic CONT'D on Return (only through the
chips); the scene navigator moves scenes only within a sequence, and has no
drag; the story bible has no places, so only the characters are offered before
first use. Known gaps: `(MORE)` and `(CONT'D)` are English strings in every
language, and FDX loses sequence titles.
