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
format for later phases, never the stored one.

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
- `scenes` and `dialogueGroups`: structure derived from the flat blocks.

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
`sequenceCursors` gives where each starts, `estimatePages` the total. Export
will concatenate the same way.

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

## The web editor

- **Locked type.** `.ProseMirror.screenplay` is 12pt Courier Prime
  (`next/font`, self-hosted, loaded only when a script is on the page), a
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

## The phone

The phone edits plain lines in the native view (see `AGENTS.md`, "Patched
native editor"). It mirrors the engine, offers Shot in the element bar (its
Tab button follows the same ring), keeps an unknown element through every
flush, and carries the Beta mark. It does **not** lay out the page or count
pages yet; the planned read-only page view will call the same engine.

## Beta

Mark screenplay formatting Beta wherever the author meets it. Today: the kind
picker (web `Library.tsx`, phone `NewManuscriptForm` and the onboarding goal
screen), the element bar (web and phone) and the Settings section. Web uses
`BetaBadge` (`src/components/BetaBadge.tsx`, English only: the web has no
locales); the phone uses `components/BetaBadge.tsx` with `screenplay.beta` and
`screenplay.betaInfo` in all four locales. The export entry gets the same mark
when it exists. When screenplay leaves Beta, remove the badges and the
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

Belongs to later phases, and is not in the first one: language gating for
languages without script support (phase 1b); the screenplay PDF, Fountain
export and import (phase 1, export); element-aware AI paths and the
element-aware phone chat insert (phase 1, AI and phone); autocomplete,
typed-input capitals and the scene navigator (phase 2); the title page,
`(MORE)`/`(CONT'D)`, dual dialogue, centered text and FDX export (phase 3);
a native phone writing surface (phase 4).
