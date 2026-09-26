# Tracked changes (suggestions)

A suggestion is a proposed edit that waits in the prose until the author
accepts or rejects it. Ciciro's line edits arrive this way by default, and the
author can switch the desk editor into **Suggest** mode to track their own
edits the same way.

## Where suggestions live

Suggestions are inline marks in the chapter HTML, not rows in a table:

```html
<p data-block-id="b1">She <del data-suggestion-id="sg-1a2b" data-author-id="ciciro"
data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z">walked
slowly</del><ins data-suggestion-id="sg-1a2b" ...>ambled</ins> to the door.</p>
```

- Every `<ins>` and `<del>` that shares a `data-suggestion-id` is one change,
  so a replacement is accepted or rejected as a unit.
- `data-author-id`, `data-author-name`, and `data-created-at` say who proposed
  it and when. Ciciro is `ciciro`; the author is their account id (or
  `author` on a local, signed-out install).
- Plain `<del>` / `<ins>` without the id attribute are ordinary formatting,
  not suggestions.

Because the marks are part of the block HTML, they travel through every
existing write and sync path unchanged: the op log carries whole blocks, so the
server, the desk, and the phone's replica always agree on what is pending. No
schema or op-format change was needed.

## One set of rules, three places

`src/lib/suggestions.ts` holds the rules: parse and serialize inline marks,
list pending changes, accept or reject them, turn a find/replace into a
word-level suggestion, and the phone's display/carry helpers. The Expo app
cannot import from the Next app, so `apps/mobile/lib/suggestions.ts` is a
byte-for-byte copy; `test/suggestions-parity.test.ts` fails if they drift.
Edit one, copy it over the other.

- Accepting drops deleted text and unwraps inserted text; rejecting does the
  reverse. A paragraph whose words were all removed (a whole-paragraph
  deletion accepted, a whole-paragraph insertion rejected) is dropped rather
  than left empty. Blocks without a matching suggestion come back
  byte-for-byte.
- **Pending means not applied.** Word counts (`chapterWordCount` in
  `src/lib/text.ts`, and the phone's replica) and the `.docx` export read the
  chapter through `htmlWithoutSuggestions`: deleted text still counts, inserted
  text does not, until the author decides.

## Ciciro's line edits

`edit_manuscript` checks the owner's `aiSuggestions` setting (on by default;
**Ciciro suggests edits** in Settings on both apps). When it is on,
`src/lib/suggestion-edits.ts` proposes each find/replace as a suggestion:

- Matching ignores whitespace differences and inline formatting, and each
  occurrence becomes its own suggestion.
- Only the words that changed are marked ("walked slowly" -> "ambled"), and a
  multi-paragraph find pairs paragraphs with the replacement's paragraphs.
- Text under someone else's pending suggestion is left alone and reported, so
  the model can ask the author to resolve it first. Ciciro may rework its own
  pending suggestion by quoting either its old or new wording.
- The model sees pending changes inline as `[-removed-]{+added+}` in
  `read_chapter` and the open-chapter context, and run verification judges the
  chapter as it would read with suggestions accepted.

## Desk editor

TipTap renders the marks with `SuggestionInsertion` / `SuggestionDeletion`
(`src/lib/tiptap-suggestions.ts`). In Suggest mode an `appendTransaction`
plugin rewrites each edit: typed or pasted text gains an insertion mark,
deleted text is put back struck through, and deleting a pending insertion
removes it outright. Undo, redo, and content arriving from the server are
never tracked. Paragraph splits and joins and formatting changes apply
directly; only words are tracked.

Accepting or rejecting goes through the shared rules and is applied as the
smallest replace, so the caret, scroll position, and undo history survive.

## Phone

The native editor has no tracked-change marks, so `toEnrichedHtml` shows
pending changes as underline (added) and strikethrough (removed), and
`opsFromEnrichedHtml` restores the real marks with `carrySuggestions`, which
aligns characters against the previous document. An untouched chapter writes
nothing on flush. The review sheet lists each change in context with Accept and
Reject; resolving is an ordinary op commit. The grammar pass skips paragraphs
with pending changes.

## Anchoring other annotations

A pending change is addressed as (block id, suggestion id): the durable
`data-block-id` every replica already agrees on, plus the inline mark's id.
Anything else that needs to hang off a span of prose, such as a beta reader's
comment, can use the same pair with its own inline element and id. The shared
parser keeps unknown inline elements (and their attributes) intact through
every rewrite, and `listSuggestions`-style scanning by id works the same way.
