# Writing exercises (mobile)

The guided exercises under **+** on the phone's manuscripts list. How they are built is in `AGENTS.md`
("Guided writing exercises"); this file records where each one comes from, so a credit line in the app
stays honest and a new exercise can be weighed against what was already considered.

Every exercise is local and AI-free: a page, a gentle timer that never locks anything, and the option to
keep the result as a journal manuscript or copy it.

## What ships

| Exercise | Parts | Follows | Why it is here |
| --- | --- | --- | --- |
| Observe, react, narrate | Observe, React, Narrate (7 min each), sensory settle-in | Ciciro's own | The original exercise: notice, feel, then make a small story |
| Pour it out | One page (10 min), short settle-in | Julia Cameron's Morning Pages, Peter Elbow's freewriting, Natalie Goldberg's writing practice | Unfiltered writing to clear the head; the rule is to keep going and not fix |
| One true sentence | One sentence (2), the next ones (5), a way back in (2) | Ernest Hemingway, *A Moveable Feast*; his stop-while-you-know-what-comes-next habit in *The Paris Review* | The lowest-barrier way into a blank page, ending by leaving a note for tomorrow |
| The terrible first draft | The terrible draft (5), find a keeper (3) | Anne Lamott, "Shitty First Drafts" in *Bird by Bird* | Permission to write badly on purpose, for self-criticism and block |
| A list of nouns | The list (3), the pull (7) | Ray Bradbury's lists of nouns, *Zen in the Art of Writing* | An association-first way to find an idea when none arrives |

## Sources

Checked in October 2026 against the pages below; the primary texts were not available to read, and The Paris
Review's own page for the Hemingway interview was unreachable, so those quotations rest on the reproductions
named here.

- **Morning Pages.** "Three pages of daily longhand stream-of-consciousness writing", from Julia Cameron's
  *The Artist's Way* (1992); the content is "anything and everything" and only the writer reads it.
  Zachary Petit's summary for Writer's Digest: <https://www.writersdigest.com/improve-my-writing/artists-way>.
  The phone version is timed (ten minutes) instead of counted in longhand pages.
- **Freewriting.** Peter Elbow, *Writing Without Teachers* (Oxford University Press, 1973), the case for
  non-stop, uncensored writing before any editing, said to help people who get stuck. Catalogue record:
  <https://bemis2.marmot.org/Record/.b17639906>.
- **Writing practice.** Natalie Goldberg, *Writing Down the Bones* (1986). Her rules as summarised by
  secondary sources: keep your hand moving, don't cross out, don't worry about spelling, punctuation or
  grammar, lose control, don't think, go for the jugular
  (<https://thewritespot.us/natalie-goldbergs-six-rules-of-writing-practice/>;
  <https://writingnsw.org.au/andy-griffiths-on-natalie-goldberg/>). The lists differ between sources, which is
  why only the shared idea (don't stop, don't fix) is used.
- **One true sentence.** Hemingway's memoir *A Moveable Feast*: "All you have to do is write one true
  sentence. Write the truest sentence that you know." (Quoted in the review of Mark Cirino's *One True
  Sentence*: <https://shelf-awareness.com/readers/2022-07-15/one_true_sentence:_writers_readers_on_hemingway_s_art.html>.)
  The in-app guide paraphrases it and does not put it in quotation marks.
- **Stopping while you know what comes next.** Hemingway in *The Paris Review*, "The Art of Fiction No. 21"
  (Spring 1958): "as you always stop when you know what is going to happen next, you go on from there", and
  "You write until you come to a place where you still have your juice and know what will happen next and you
  stop". Quoted from Mason Currey's *Daily Rituals* at <https://fs.blog/hemingways-routine/>. A sharper
  version of the advice is often attributed to a 1935 *Esquire* piece; that attribution was not confirmed, so
  the app cites the *Paris Review* interview only.
- **Terrible first drafts.** Anne Lamott, *Bird by Bird* (1994), the chapter "Shitty First Drafts": she
  says the only way she gets anything written is to write really bad first drafts. The chapter is hosted
  by the Brandeis writing program (<https://www.brandeis.edu/writing-program/shitty-first-drafts.pdf>); the
  quotation is also given, with a page reference, at <https://marlataviano.substack.com/p/shitty-first-drafts>.
  The second part ("find a keeper") is Ciciro's own step, not Lamott's.
- **Lists of nouns.** Ray Bradbury, *Zen in the Art of Writing*: he wrote lists of nouns from his own
  memories and fears ("THE LAKE. THE NIGHT. THE CRICKETS. THE RAVINE. THE ATTIC. THE BASEMENT. THE
  TRAPDOOR.") and then, as he put it, ran through them, picked a noun, and sat down to write "a long
  prose-poem-essay on it". Source: <https://www.themarginalian.org/2013/10/18/ray-bradbury-on-lists/>. The
  exact lists vary between reproductions, so the app's examples are its own.

Considered for the settle-in, not shipped as an exercise: Haruki Murakami describes a fixed daily routine
(up around 4am, several hours' writing, then exercise, bed by 9pm) that he treats as a way of putting himself
into a trance-like state (*The Paris Review*, "The Art of Fiction No. 182", 2004;
<https://www.theparisreview.org/blog/?p=153857>). A ritual of that kind is a habit, not a ten-minute exercise,
so it only informed how the short settle-in before a page works.

## Left for later

- **Constraint writing.** Raymond Queneau's *Exercises in Style* retells one trivial incident in many styles,
  and the Oulipo's constraints (a lipogram, a fixed length) work as "retell it three ways" or "say it in fifty
  words". Distinct from everything above; it wants a seed event and a set of constraints per language.
- **Dialogue-only drills.** Write a scene as speech only, with no tags or description. A strong fit for
  screenwriters, but there is no single writer whose practice it follows, so it would ship uncredited.
- **"I remember".** Goldberg's repeated-stem prompt (after Joe Brainard's *I Remember*), a variation on
  Pour it out that could be its opening line.

## Adding one

An exercise is an entry in `EXERCISES` (`apps/mobile/lib/writing-exercise.ts`) and its copy under
`exercise.items.<id>` in all four locales; `apps/mobile/__tests__/writing-exercise.test.ts` fails when copy
is missing. Set `credited` only when the attribution is accurate, and name the work in the credit line. An
id is permanent: analytics carries it.
