# Story bible

The story bible is the shared memory Ciciro uses to stay consistent. It is a
folder of markdown files on disk. The editor reads them to plan, and writes
decisions back so facts are not lost to chat scrollback.

![Story Bible drawer listing canon, character, plot, style, timeline, and world files](images/story-bible.png)

Open it from **Story bible** in the manuscript header's **More** menu. Each row is a file you
can edit in the drawer or in any text editor. They live at
`data/<projectId>/bible/` and are gitignored as author content.

## What belongs where

| File | Keep here |
|---|---|
| `canon.md` | Hard facts and author rulings the story must never contradict. POV/tense, settled names, "the fire was arson." Short, always loaded. |
| `plot.md` | Structure, beats, open loops, payoffs. Check off loops as they resolve. |
| `style.md` | Voice, POV, tense, prose rules, dialogue conventions, narrator. Theme/tone notes belong here too. |
| `timeline.md` | Chronology on and off the page. Pull this when time order matters. |
| `world.md` | Settings, lore, and rules of the world. |
| `characters/<slug>.md` | One file per character: role, description, arc, and a **Voice** section (diction, rhythm, tics). |

The first non-empty line of each file is the one-line summary in the index. Put
the useful label first so the editor can find the right file without opening
everything.

## How the editor uses it

Context is built in tiers so it never bloats:

1. **Always loaded:** `canon.md`, `plot.md`, `style.md`.
2. **Index:** one-line summaries of every other bible file and every chapter.
3. **On demand:** full character files, world, timeline, and chapters - pulled
   with `read_bible` / `read_chapter` / `search_manuscript`.

That is why canon, plot, and style should stay small and current. Character
backstory, maps, and deep lore can be longer; they are opened only when needed.

When you establish a fact in chat ("she's British", "do not resolve the fire
yet"), the editor should record it in the same turn (`append_canon` or
`update_bible`) and tell you what it wrote. If it flags something instead of
writing it, confirm so it lands in the file, not only in the thread.

## Adding context for consistency

**Characters.** In the Story Bible footer, type a name and click **Add**. That
creates `characters/<slug>.md`. Fill in Voice early - the drafter never sees
the bible, so the editor copies voice notes into each brief. Distinct speech
patterns here are how dialogue stays in character across chapters.

**Who knows what.** Knowledge is a ledger, not another copy of the character
sheet. Each fact is a row: which character file it belongs to
(`characters/<slug>.md`), the line itself, whether they **know** it or only
**believe** it, and the chapter that made it true. The character table in the
database is not this list. Open a character file in the Story Bible and use
**Who knows what** to add or retire a fact. Retiring marks it superseded; it
is not deleted from the ledger's history.

The file still shows the same lines. On every add, retire, or **Keep** from
What changed, Ciciro rewrites only the block between `<!-- knows:start -->`
and `<!-- knows:end -->` at the end of that character file. The table is the
source of truth. The block is a mirror, so `read_bible` and a person opening
the file see the same thing. The editor's context includes a short capped
list of those facts for characters named in the open chapter. The continuity
check treats a "Who knows what" line like any other bible line: a
contradiction needs a verbatim quote from the chapter and from the fact, and
silence stays silence.

The ledger grows from **What changed** on the open chapter (see [Using
Ciciro](using-ciciro.md#what-changed)). That review proposes facts; it does
not write them until you keep one. It never creates a character file for a
name it does not already have.

**Canon.** Treat `canon.md` as a decision log, not a novel. One line per ruling:

```markdown
- POV / tense: close third, past
- Aiden is British; he does not code-switch in dialogue
- The fire in chapter 2 was arson (author ruling)
```

**Plot.** Keep open loops as a checklist. Ciciro's "Find loose ends" action
reads `plot.md` against the manuscript; unpaid setups only show up if they are
listed (or findable in the prose).

**Style.** Put non-negotiable prose rules here (no new named characters in a
scene, narrator knowledge, habits of yours Ciciro should keep). Em dashes are
off by default; the line `- Em dashes: allowed` switches them on (see [Craft
defaults and em dashes](using-ciciro.md#craft-defaults-and-em-dashes)). Theme alignment uses this
file. Already have chapters written? **Analyze my style** (top bar's **More**
menu) drafts this file and each speaking character's Voice section from your
own prose instead of you writing them cold - see [Using
Ciciro](using-ciciro.md#analyze-my-style).

You can also edit the files on disk. After the first run they are the source of
truth; the database is only used to seed them. Who knows what is the exception:
that ledger lives in its own table, and the block in the character file is only
the mirror.

## Practical habits

- Write rulings as facts, not vibes. "Cole lied to Mara in ch. 3; she knows"
  beats "things are tense between them."
- When a character changes, update that character file (or let Ciciro, after
  you confirm). The narrator is a tracked character too - first person in their
  file, third person in `style.md`.
- Do not paste whole chapters into the bible. The manuscript is retrieved; the
  bible holds decisions.
- If two files disagree, fix `canon.md` first. That file is always in the
  editor's prompt.

See [Using Ciciro](using-ciciro.md) for how to brief the editor so it actually
consults these files.
