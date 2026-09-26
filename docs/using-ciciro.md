# Using Ciciro

Ciciro is one editor, not a committee. You write in the manuscript; you talk to
Ciciro in the right-hand chat. It holds canon, critiques, and decides what gets
written. When prose is needed, it briefs a faster drafter behind the scenes -
you only ever see the editor.

![Ciciro workspace: chapter list, manuscript editor, and Ciciro chat](images/ciciro.png)

## The workspace

- **Chapters** (left) - add, select, and see word counts and draft status.
  Total word count sits at the bottom of the list.
- **Manuscript** (center) - the open chapter. Title, word count, status
  (`draft` / `revised` / `final`), **Auto-draft**, and **Prose** / **Diff** /
  **History** views. Write here as you would in any editor; saves are automatic.
- **Ciciro** (right) - the editor chat, quick-action chips, and composer.
  Status light, **Compact**, **Clear chat**, and **Auto on/off** live in the
  header.
- **Story bible**, **Questions**, and **Export** sit in the top bar.

Start a project from the manuscript list, then fill the [story
bible](story-bible.md) before asking for long passages. Empty canon produces
confident but ungrounded prose.

## Brief the editor, not the drafter

You never talk to the drafting model. Give Ciciro the job, the constraint, and
the destination. Specific beats land; "make it better" does not.

Strong:

> Find the poorly inserted camera passage in Chapter 1, check Chapter 2 for
> duplicates, and put it where it belongs. Do not invent new scenes.

Weak:

> Fix the book.

Name chapters, quote a line if the target is ambiguous, and say what *not* to
do (no new named characters, do not pay off loop X, keep it under 400 words).
The editor reads bible files and prior text, writes a brief (POV, beat, canon
constraints, voice notes, a continuity excerpt, a "do NOT" list), dispatches
the drafter, then edits the result against canon before showing you a
`<draft>`.

Ask it to record decisions: "She's British - put that in canon." If it
proposes a provisional choice, answer it in **Questions** so the manuscript
stays aligned.

## Quick actions

The chips above the chat are scoped prompts. Use them when the job matches;
type a custom request when it does not.

| Action | Best for |
|---|---|
| What needs work most? | Starting a session; one highest-leverage next step plus two runners-up |
| Critique this chapter | Developmental read of the *open* chapter (pacing, stakes, drag) |
| Tighten dialogue | Selected dialogue only - select first |
| Line edit selection | Prose-level pass on a highlighted passage |
| Align to theme | Language vs `style.md` theme/tone/POV |
| Find loose ends | Open loops in `plot.md` vs the manuscript |
| Ask me questions | Craft questions to sit with; it will not answer them |
| Continue writing | Next ~300-400 words from the end of the open chapter |
| Review for holes | Continuity gaps and passages that look inserted in the wrong spot |
| Fix misplaced passages | Move prose that does not belong on this chapter's throughline |

Selection-scoped chips need a highlight in the manuscript. Chapter-scoped chips
use whichever chapter is open.

## Auto insert vs Auto-draft

**Auto on/off** (chat header): when on, finished drafts insert into the open
chapter without a click. Ciciro can also create and switch chapters. Turn this
on for a sustained drafting session; leave it off when you want to accept or
reject each `<draft>`.

**Auto-draft** (chapter toolbar): an unattended pass at the open chapter. Set
a word target and optional guidance. The editor plans beats and writes without
stopping for questions, so put the important constraints in the [story
bible](story-bible.md) first. Use this for a first pass of a chapter you have
already outlined, not as a substitute for filling canon.

## Questions, compact, and diff

Ciciro does not stall on an undecided name or detail. It picks a reasonable
option, keeps writing, and logs the fork. **Questions** lists those
provisional choices. Answer one and it reconciles: if your answer matches, it
just closes the question; if it differs, it searches and corrects the prose.

**Compact** summarizes older chat so the live thread stays small. Use it on a
long conversation rather than **Clear chat** if you still need the recent
editorial thread. Clearing starts fresh; the bible and manuscript are
untouched.

**Diff** shows the editor's recent corrections to the open chapter. **Prose**
is the writing surface.

## Version history

**History** (chapter toolbar; on mobile, the clock icon on a chapter card in
the Chapters tab) lists snapshots of the open chapter. **Save snapshot** keeps
the current text, with an optional name. Ciciro also takes one on its own
before it edits the chapter, when you start writing in a chapter again after
30 minutes or more away (keeping how the last session ended), and before every
restore. It keeps the newest 50 automatic and 100 saved snapshots per chapter.

Open a version to see what restoring it would change, or its full text.
**Restore** replaces the chapter with that version; your current text is saved
to history first, and **Undo** puts it back. Ciciro will not restore or save a
snapshot while your latest edits have not reached the server, so reconnect and
try again if it says so.

## Search and replace

**Search** in the top bar (Cmd/Ctrl+Shift+F) finds text across every chapter and
shows each match with the words around it; click one to jump to it in the editor.
Turn on **Match case** or **Whole word** to narrow it, type a replacement, and use
**Replace** on a single match or **Replace all**. Replacements are ordinary chapter
edits, so they sync to the phone like anything you type. On the phone, the Chapters
tab has a Find and replace card with the same options.

## Import

Bring an existing manuscript in from Word (`.docx`, including Google Docs
downloaded as Word or as a web page `.html`), Markdown (`.md`, `.txt`), or a
Scrivener project (zip the whole `.scriv` folder first). Files are limited to
20 MB.

- **New manuscript**: use **Import a manuscript** on the manuscript list (on
  mobile, **Import manuscript** in the menu). The title defaults to the file's.
- **Add to a manuscript**: **Import** in the chapter list (on mobile, **Import
  chapters** on the Chapters tab) appends the file's chapters to the end.

Chapters split on headings. Without heading styles, lines such as "Chapter 3"
start a new chapter. In Scrivener's Draft, a folder of documents becomes one
chapter with each document as a scene, and a standalone document is its own
chapter. Bold, italic, and scene breaks carry over; images do not.

## Export

**Export > Word (.docx)** builds a Shunn-style manuscript: Times New Roman 12pt,
double-spaced, 1" margins, title page with word count, chapters on fresh
pages, running header, `#` scene breaks.

**Export > Markdown (.md)** makes a plain-text file with chapter titles as
headings and bold, italic, lists, quotes, and scene breaks preserved.

**Export > EPUB** makes an ebook (title page, contents, chapters in order) and
**Export > PDF** a book-layout PDF with a contents page and page numbers. On the
phone, the Chapters tab has an Export card that hands the file to the share sheet.

## Habits that keep the book consistent

1. **Fill the bible before you ask for volume.** Names, POV, tense, voice, and
   open loops. See [Story bible](story-bible.md).
2. **Work chapter-scoped unless the job is structural.** Open the chapter you
   mean. For moves across chapters, name source and destination ("poorly
   inserted in chapter 1; it belongs in chapter 2").
3. **Prefer one job per turn.** Critique *or* rewrite *or* reorg. Mixing
   "critique then rewrite the whole chapter then also fix chapter 6" buries
   the verification the editor runs before it marks a turn complete.
4. **Let it write canon back.** Confirm flagged character changes. Check
   `canon.md` after a session if you made rulings in chat.
5. **Use Auto-draft on a prepared chapter.** Guidance in the dialog plus a
   current `plot.md` beat list is enough; a blank bible is not.
6. **Keep `style.md` as the voice contract.** If dialogue drifts, tighten the
   Voice section on that character file, then ask for a rewrite - do not only
   complain in chat.

The editor is a critic, not a cheerleader. Ask for the line and the reason.
If a turn looks stuck, it may still be `continuing` (tool use or a long
structural pass) rather than finished - the chat shows run status for that
reason. Implementation detail lives in
[Durable editor runs](editor-agent-runs.md).
