# Craft defaults

Craft defaults steer the prose Ciciro writes away from habits common in
model-written text, without touching the author's own prose or overriding
their voice. The user-facing description is in
[Using Ciciro](using-ciciro.md#craft-defaults-and-em-dashes).

## Where they come from

`src/lib/craft-defaults.ts` holds one list of habits per kind of manuscript
(fiction for novels and screenplays, nonfiction for blogs, none for journals).
Each habit has a short name and the instruction the drafter gets. The rules are
Ciciro's own wording, drawn from two sources:

- [blader/humanizer](https://github.com/blader/humanizer) (MIT), a prompt built
  on Wikipedia's "Signs of AI writing". Its structural patterns carry over to
  fiction (staged contrasts, closers that explain the scene, lines that sound
  wise, forced triads, repeated openings). Its word list and formatting
  patterns mostly do not, so only the blog list uses them.
- [StoryScope](https://arxiv.org/abs/2604.03136) (Russell et al.). Its
  released feature table for 61,575 stories shows where Claude-written short
  fiction differs most from published human fiction: feelings mirrored by
  setting, stated themes, an earnest-lyrical register, long balanced sentences,
  sustained conceits, avoidance in place of confrontation, and extended,
  reconciling endings. Plot-level choices belong to the author, so they appear
  only as "do not resolve unless the brief asks".

Neither project's code, data, or classifier ships in Ciciro. Getting past AI
detectors is not a goal.

## Where they plug in

| Stage | What changes |
|---|---|
| Drafter system prompt | `drafterSystemFor(kind, { emDashes })` in `src/lib/prompts.ts` appends the kind's craft block and the rule that the author's voice wins. |
| Editor system prompt | `editorSystemFor` appends a "Craft defaults for drafted prose" section: the habit names, "put the author's deliberate habits in the voice notes", and how to treat a CRAFT CHECK. |
| After each draft | `checkDraft` in `src/lib/prose-tells.ts` runs mechanical checks (em dashes when style.md keeps them off, three sentences in a row opening on the same word) and one low-effort `DRAFTER_MODEL` call for the habits that need judgment. Every quote must be an exact substring of the draft. `formatCraftCheck` turns the findings into the CRAFT CHECK block. |
| `dispatch_draft` (`src/lib/tools.ts`) | The CRAFT CHECK is appended to the tool result the editor reads. The fast drafter gets the mechanical checks only. |
| Auto-draft (`src/lib/autowrite.ts`) | Each beat's CRAFT CHECK goes into `editBeatInstruction`, before the editor edits the beat to final. |

The check is part of an AI run that is already metered, so it claims nothing
itself. It never throws: with no key or a failed call, the mechanical findings
still come back. Cost is one Sonnet call per quality draft, roughly $0.01 and a
few seconds.

## Em dashes

Ciciro writes no em dashes unless the project's `style.md` has a line
`Em dashes: allowed` (`emDashesAllowed`, which also accepts bold and hyphenated
spellings). New projects seed `- Em dashes: not allowed; ...` so the switch is
visible. The drafter cannot see `style.md`, so each caller reads the switch and
passes `emDashes` in. The editor sees `style.md` in context and its dash rule
names the exception. Ciciro's own messages, summaries, and recaps stay
dash-free either way.

## The side-by-side demo

`scripts/craft-demo` drafts eight fixed scenes (six novel scenes, including one
whose author writes with em dashes, one screenplay page, and one blog post)
through the current pipeline and the craft-defaults pipeline. Each run is one
auto-draft beat: Sonnet drafts, Opus edits to final. An Opus judge then compares
each matched pair blind, in both orders, on quality, the author's voice, and
following the brief. The baseline arm uses `craft: false`, which
`test/craft-defaults.test.ts` pins to the prompts as they were before craft
defaults.

```sh
npm run demo:craft -- --dry-run               # mock client: no key, prints the estimated cost
ANTHROPIC_API_KEY=... npm run demo:craft      # real run, 3 samples per scene
npm run demo:craft -- --samples 1 --scenes kitchen,noir
```

Output goes to `.craft-demo/` (git-ignored): `index.html` shows the matched
pairs with the check's findings highlighted, the editor's changes as a word
diff, and the judges' verdicts, and `results.json` has the raw data. A real run
refuses to start when its estimate is above `--max-usd` (default 25). With the
defaults, the estimate is about $7 (216 calls). Opus thinking varies, so budget
up to about $15.
