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

## Scratchpad

**Scratchpad** in the top bar (on mobile, the Scratchpad card in the Chapters
tab) keeps loose notes and research for the manuscript: a name to remember, a
fact to check, a scene idea. Add as many notes as you like (up to 200), each with
a title and free text; they save as you type. On the web, if a save fails you
can still close the note: your text stays in the browser, the list marks it
"Not saved yet, will retry", and Ciciro keeps retrying until it saves. Notes are not chapters, so they are
never counted in your words or writing-day stats and never appear in an export
or in search. They sync between the web and your phone. If the same note is
edited on two devices, Ciciro asks whether to keep your version or the other one
rather than overwriting either.

## Beta readers

**Beta readers** in the top bar (on mobile, the Beta readers card in the Chapters
tab) is where you share the book and read what came back.

Under **Share links**, name the link (who it is for), share the whole manuscript
or only chosen chapters, and pick when it stops working: in 7, 30 or 90 days, or
never. **Make link and copy** puts the link on your clipboard; on the phone it
opens the share sheet. A whole-manuscript link includes chapters you add later;
archived chapters are never shown. Anyone with the link can read those chapters
in a browser without an account, and nothing else of yours: not your other
chapters or manuscripts, the story bible, the chat, or other readers' comments.
**Turn off** stops a link for good (readers see "This link is not available")
and keeps the comments it collected; **Delete** removes the link and its
comments.

Readers select a passage, press **Comment**, sign with a name, and send. Their
comments show under **Comments**, grouped by chapter, with the quoted passage.
Open comments are underlined in the editor; click one to open its comment.
**Show in text** jumps to the passage even after you have edited around it,
**Resolve** files a comment under Resolved (and **Reopen** brings it back), and
**Delete** removes it. On the phone, a chapter with open comments shows a pill
over the page that opens them. A reader can leave a few comments a minute, and
a link takes at most a couple of hundred an hour.

## Search and replace

**Search** in the top bar (Cmd/Ctrl+Shift+F) finds text across every chapter and
shows each match with the words around it; click one to jump to it in the editor.
Turn on **Match case** or **Whole word** to narrow it, type a replacement, and use
**Replace** on a single match or **Replace all**. Replacements are ordinary chapter
edits, so they sync to the phone like anything you type. On the phone, the Chapters
tab has a Find and replace card with the same options.

## Outline

Open **Outline** in the top bar (web) or the Outline card on the Chapters tab (mobile) to see every chapter as a card with its title, summary, word count and stage. On the web, switch between **Corkboard** and **List** layouts and change a chapter's stage from its card. Drag a card to reorder chapters, or use the arrows (web) or the accessibility move actions (mobile). The new order is saved to the manuscript and shows up on your other devices.

## Focus and typewriter mode

**Focus** in the top bar (Cmd/Ctrl+Shift+Enter) hides everything but the page;
press Esc or **Exit focus** to leave. On the phone, tap **Focus mode** in the
editor header or turn it on in Settings; the header and tab bar hide while you
are on the editor. Focus mode is remembered per device, not synced.

**Typewriter** (Cmd/Ctrl+Alt+T, or the Settings toggle on the phone) keeps the
line you are writing centered on the screen, and it syncs across devices. On
the phone the page gets extra room at the bottom so the last lines can scroll
up to the middle, but the editor cannot re-center on every keystroke the way
the web does.

## Read aloud

Hearing a chapter is a good way to catch clunky lines. On the web, choose **Listen** in the top bar; on the phone, tap **Listen** above the editor or open the **Read aloud** card in the Chapters tab.

- It reads your selection if you have one, otherwise the whole chapter, one sentence at a time, with the sentence being read highlighted.
- Use Play, Pause (Resume) and Stop, and pick a speed and a voice. Speed and voice are remembered on that device only, since each device has its own voices.
- The web uses your browser's built-in speech, so the available voices depend on the browser and system. On the phone, the highlighted text is shown on the Read aloud screen because the editor itself cannot draw highlights.
- Switching chapters stops the reading. Nothing is sent to Ciciro's servers or saved to your manuscript.

## Dictation

**Dictate** in the top bar (web) or the microphone at the end of the formatting
bar (phone) turns your voice into text at the caret. Tap it again to stop.
Finished phrases are typed in as you pause, with the joining space and a
capital at the start of a sentence added for you; the words still being
recognized show beside the button until they settle. In English you can say
"new paragraph" or "new line" to break, and "question mark", "exclamation
mark", "full stop", "colon" or "semicolon" for that punctuation. Other
languages get the recognizer's own punctuation.

On the web it uses the browser's speech recognition (Chrome, Edge and Safari);
in browsers without it, such as Firefox, the button is not shown. Chrome sends
the audio to Google's speech service, so it needs a connection. On the phone it
uses the system recognizer and asks for microphone and speech recognition
access the first time. It needs a development build: the button is hidden in
Expo Go, which does not include the speech module. Dictation stops when you
change chapters.

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

## Suggestions (tracked changes)

With **Ciciro suggests edits** on (the default, in the appearance and writing
settings), Ciciro's line edits do not change your prose. They arrive as
suggestions: removed words struck through in red, added words underlined in
green. A bar above the chapter counts them and steps through them; click a
change for a card with who proposed it, when, and **Accept** / **Reject**, or
use **Accept all** / **Reject all**. Escape closes the card.

Turn on **Suggest** in the chapter bar to track your own edits the same way:
typing is marked as an addition, deleting strikes the text through, and
deleting your own pending addition simply removes it. Paragraph breaks and
formatting apply directly.

Pending suggestions are not part of the book yet: word counts and every
export leave them out until you accept them. On the phone they show inline
(underlined or struck through), and the banner above the chapter opens a
review sheet with the same Accept and Reject. How it works:
[Tracked changes](tracked-changes.md).

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
