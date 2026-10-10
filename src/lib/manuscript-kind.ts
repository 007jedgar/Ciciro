// What kind of writing a manuscript is. "novel" is the original behavior and
// the default for every manuscript created before kinds existed.
//
// Must stay in step with apps/mobile/lib/manuscript-kind.ts (test/manuscript-kind.test.ts
// checks the two agree).

import { elementTagOfHtml, knownElement, normalizeElement, withElement, type ScreenplayElement } from "./screenplay";

export const MANUSCRIPT_KINDS = ["novel", "screenplay", "blog", "journal"] as const;
export type ManuscriptKind = (typeof MANUSCRIPT_KINDS)[number];

export const DEFAULT_KIND: ManuscriptKind = "novel";

export function isManuscriptKind(value: unknown): value is ManuscriptKind {
  return typeof value === "string" && (MANUSCRIPT_KINDS as readonly string[]).includes(value);
}

/** Anything unrecognized (old rows, hand-edited requests) reads as a novel. */
export function normalizeKind(value: unknown): ManuscriptKind {
  return isManuscriptKind(value) ? value : DEFAULT_KIND;
}

/**
 * The kinds that have settings of their own, shown in a section at the top of
 * Settings while that manuscript is open (and nowhere else). A new kind-specific
 * setting goes in that kind's section component, web and phone.
 */
const KINDS_WITH_SETTINGS: readonly ManuscriptKind[] = ["screenplay"];

export function hasKindSettings(kind: ManuscriptKind): boolean {
  return KINDS_WITH_SETTINGS.includes(kind);
}

export type KindInfo = {
  label: string;
  description: string;
  /** What one chapter is called in this kind of writing. */
  unit: string;
  unitPlural: string;
  /** One chapter only: a blog post or newsletter is a single piece. */
  singlePiece: boolean;
};

export const KIND_INFO: Record<ManuscriptKind, KindInfo> = {
  novel: {
    label: "Novel",
    description: "Chapters, a story bible and a long draft.",
    unit: "Chapter",
    unitPlural: "Chapters",
    singlePiece: false,
  },
  screenplay: {
    label: "Screenplay",
    description: "Scene headings, action, dialogue and transitions in standard format.",
    unit: "Sequence",
    unitPlural: "Sequences",
    singlePiece: false,
  },
  blog: {
    label: "Blog post or newsletter",
    description: "One piece with a title and a subtitle.",
    unit: "Post",
    unitPlural: "Posts",
    singlePiece: true,
  },
  journal: {
    label: "Journal",
    description: "Dated entries, with a new entry for today one tap away.",
    unit: "Entry",
    unitPlural: "Entries",
    singlePiece: false,
  },
};

const DEFAULT_TITLES: Record<ManuscriptKind, string> = {
  novel: "Untitled Manuscript",
  screenplay: "Untitled Screenplay",
  blog: "Untitled Post",
  journal: "Journal",
};

/** What a manuscript is called when its author does not name it. */
export function defaultTitle(kind: ManuscriptKind): string {
  return DEFAULT_TITLES[kind];
}

// --- Screenplay elements -----------------------------------------------------

// The element model (the elements, Tab and Enter, `data-sp` on a block) lives
// in screenplay.ts, which the phone mirrors byte for byte. Re-exported so the
// callers that already import it from here keep working.
export {
  SCREENPLAY_ATTR,
  SCREENPLAY_ELEMENTS,
  SCREENPLAY_ELEMENT_LABELS,
  cycleElement,
  elementOfHtml,
  elementTag,
  isScreenplayElement,
  knownElement,
  nextElementOnEnter,
  normalizeElement,
  elementTagOfHtml,
  withElement,
  type ScreenplayElement,
} from "./screenplay";

/** Elements the spell checker and the grammar pass leave alone: names, slugs and cues are not prose. */
const UNCHECKED_ELEMENTS: readonly ScreenplayElement[] = ["scene-heading", "character", "transition", "shot"];

export function isProofread(element: ScreenplayElement): boolean {
  return !UNCHECKED_ELEMENTS.includes(element);
}

// --- Journal -----------------------------------------------------------------

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today as YYYY-MM-DD in the runtime's local time. */
export function localYmd(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A real calendar date in YYYY-MM-DD form, or null. */
export function parseYmd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(YMD);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  const real =
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return real ? value : null;
}

/** "Saturday, September 26, 2026": the title of a journal entry. */
export function journalEntryTitle(ymd: string): string {
  const valid = parseYmd(ymd);
  if (!valid) return ymd;
  const [y, mo, d] = valid.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS[mo - 1]} ${d}, ${y}`;
}

/** The chapter to open for "new entry for today", if one already exists. */
export function findEntryForDate<T extends { title: string }>(chapters: T[], ymd: string): T | null {
  const title = journalEntryTitle(ymd);
  return chapters.find((chapter) => chapter.title.trim() === title) ?? null;
}

// --- Opening chapter ---------------------------------------------------------

export type OpeningChapter = { title: string; content: string };

/** The first chapter a new manuscript of this kind starts with. */
export function openingChapter(
  kind: ManuscriptKind,
  opts: { title?: string; today?: string } = {}
): OpeningChapter {
  switch (kind) {
    case "screenplay":
      return {
        title: "Sequence 1",
        content: withElement("<p></p>", "scene-heading"),
      };
    case "blog":
      return { title: opts.title?.trim() || "Post", content: "" };
    case "journal":
      return { title: journalEntryTitle(parseYmd(opts.today) ?? localYmd()), content: "" };
    default:
      return { title: "Chapter 1", content: "" };
  }
}

/** Default title for the Nth chapter added to a manuscript of this kind. */
export function nextChapterTitle(kind: ManuscriptKind, count: number): string {
  if (kind === "screenplay") return `Sequence ${count + 1}`;
  if (kind === "blog") return "Post";
  return `${KIND_INFO[kind].unit} ${count + 1}`;
}

// --- Marked script lines ------------------------------------------------------

/**
 * The marks that force a line's element: Fountain's forced-element markers, plus
 * `^` for a shot, which Fountain has no word for. A dialogue or parenthetical
 * line carries no mark: it sits under its cue, the way it does in Fountain.
 */
const MARK_ELEMENT: Readonly<Record<string, ScreenplayElement>> = {
  ".": "scene-heading",
  "!": "action",
  "@": "character",
  ">": "transition",
  "^": "shot",
};

/** The mark an element's line starts with, for the elements that have one. */
export const ELEMENT_MARK: Readonly<Partial<Record<ScreenplayElement, string>>> = {
  "scene-heading": ".",
  action: "!",
  character: "@",
  transition: ">",
  shot: "^",
};

/**
 * The output contract for script text, in the assistant's prompts: how it reads
 * the script and how it writes one back. `parseScriptLines` is the other half.
 */
const SCRIPT_FORMAT = `  .INT. KITCHEN - NIGHT       scene heading
  !Mara stares at the phone.  action (also an ALL-CAPS action line: !BOOM. !SHE RUNS OUT.)
  @MARA                       character cue, in caps (@MARA (V.O.), @MARA (CONT'D))
  (quietly)                   parenthetical, in brackets, directly under a cue
  He never called.            dialogue, directly under a cue or a parenthetical, no mark
  >CUT TO:                    transition
  ^CLOSE ON THE KNIFE         shot: a camera direction (ANGLE ON, POV, INSERT)
  A blank line ends a speech; a cue, its parentheticals and its dialogue have none between
  them. Dialogue never begins with a mark character.`;

// --- AI assistant ------------------------------------------------------------

const DIRECTIVES: Record<ManuscriptKind, string> = {
  novel: "",
  screenplay: `# This manuscript is a SCREENPLAY, not a novel
Treat every "chapter" as a sequence of scenes and every "draft" as script pages.
- Write in standard screenplay form: SCENE HEADINGS (INT./EXT. LOCATION - TIME),
  action in present tense and lean, CHARACTER cues in caps, dialogue beneath them,
  parentheticals only when the delivery would otherwise be unclear, transitions
  (CUT TO:, FADE OUT.) sparingly. Never write novel-style narration, interiority,
  or camera-free description that cannot be filmed.
- The script is stored as typed elements, one block per line, and you read and write
  it as marked script lines.
${SCRIPT_FORMAT}
- A passage id (chN.sK) is a scene: it runs from a scene heading to the next one, and
  list_passages names each scene by its heading.
- Use marked lines for every piece of script text you hand over: a <draft>, insert_text,
  the replace of edit_manuscript, and the pages you ask the drafter for. When you match
  existing text (find, quotes, anchors), use its plain words: the marks and a
  parenthetical's brackets are how you read the script, they are not part of the stored
  text (find quietly, not (quietly)).
- Critique for what plays on screen: visual storytelling, subtext in dialogue,
  scene entry and exit, act structure, and page count (about a minute per page).
- Brief the drafter for script pages, naming each speaking character and the
  scene's location and time of day.`,
  blog: `# This manuscript is a BLOG POST or NEWSLETTER, not a novel
It is one self-contained piece with a title and a subtitle (the logline). There is
one section to work on; do not propose chapters or a multi-chapter plan.
- Write for a reader skimming on a screen: a strong first line, short paragraphs,
  clear subheads, and a purposeful ending or call to action.
- Critique the hook, the single argument or story, the structure, the headline and
  subtitle, and where a reader would stop reading.
- Keep the author's voice. Match a conversational or essayistic register unless
  they show otherwise.`,
  journal: `# This manuscript is a JOURNAL, not a novel
Each "chapter" is one dated entry, in the author's own first-person voice. It is
private writing, not a story to be shaped for readers.
- Never invent events, feelings, or facts about the author's life. Offer prompts
  and questions; write only what they ask you to, and only from what they told you.
- Be warm and unhurried. Do not critique prose quality unless asked. Do not push
  plot, stakes, or structure.
- Helpful moves: a reflective prompt for today, a gentle question about an entry,
  noticing a pattern across entries, or tidying wording while keeping their voice.`,
};

/** Extra system prompt text for this kind. Empty for a novel. */
export function kindDirective(kind: ManuscriptKind): string {
  return DIRECTIVES[kind];
}

export const DRAFTER_DIRECTIVES: Record<ManuscriptKind, string> = {
  novel: "",
  screenplay: `The piece is a screenplay. Return script pages as marked lines, one element per
line, and nothing else (no headings, notes or commentary).
${SCRIPT_FORMAT}
Standard form: lean present-tense action, CHARACTER names in caps above their dialogue,
parentheticals only where needed. No novel narration.`,
  blog: `The piece is a blog post or newsletter. Write clear, skimmable prose with short
paragraphs and a direct voice.`,
  journal: `The piece is a private journal entry. Write in the author's first person, plainly,
and invent no events or feelings beyond what the brief states.`,
};

export function drafterDirective(kind: ManuscriptKind): string {
  return DRAFTER_DIRECTIVES[kind];
}

// --- Screenplay text from the assistant --------------------------------------

const SCENE_HEADING = /^(?:INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[.\s]/i;
const TRANSITION = /^(?:[A-Z][A-Z .'-]*\bTO:|FADE (?:IN|OUT)[.:]?|FADE TO BLACK[.:]?|CUT TO BLACK[.:]?|SMASH CUT:|DISSOLVE TO:|THE END\.?)$/;
const CHARACTER_CUE = /^[A-Z][A-Z0-9 .'-]{0,38}(?:\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D)\))?$/;
const SHOT =
  /^(?:(?:EXTREME )?CLOSE(?:[ -]?UP\b| ON\b)|ECU\b|INSERT\b|ANGLE ON\b|(?:NEW|REVERSE) ANGLE\b|WIDE (?:ON|SHOT)\b|(?:[A-Z][A-Z.'-]* )?POV\b|(?:TRACKING|OVERHEAD|AERIAL|ESTABLISHING|MOVING|MEDIUM|LONG|FULL|TWO) SHOT\b|BACK TO SCENE\b|PUSH IN\b|PULL BACK\b)/;

/** Whether an all-caps line is a camera direction (CLOSE ON, ANGLE ON, POV, INSERT and the like). */
export function isShotLine(line: string): boolean {
  return SHOT.test(line);
}

/**
 * Sort a script written as plain lines (what the assistant returns) into
 * screenplay elements. A line under a character cue is dialogue until a blank
 * line; a camera direction (CLOSE ON, ANGLE ON, POV, INSERT) is a shot; anything
 * unrecognized is action. A parenthetical comes back without its brackets.
 */
export function classifyScreenplayLines(
  text: string,
  after?: ScreenplayElement
): { element: ScreenplayElement; text: string }[] {
  const out: { element: ScreenplayElement; text: string }[] = [];
  const speaking = (el?: ScreenplayElement) => el === "character" || el === "parenthetical" || el === "dialogue";
  let inDialogue = after === "character" || after === "parenthetical";
  let previous = after;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      inDialogue = false;
      previous = undefined;
      continue;
    }
    const caps = line === line.toUpperCase();
    const cue = CHARACTER_CUE.test(line) && caps;
    let element: ScreenplayElement;
    if (SCENE_HEADING.test(line)) element = "scene-heading";
    else if (TRANSITION.test(line)) element = "transition";
    else if (inDialogue && /^\(\s*\S.*\)$/.test(line)) element = "parenthetical";
    else if (caps && SHOT.test(line) && previous !== "character" && previous !== "parenthetical") element = "shot";
    else if (inDialogue && !(cue && previous === "dialogue")) element = "dialogue";
    else if (cue) element = "character";
    else element = "action";
    inDialogue = speaking(element);
    previous = element;
    // The page draws a parenthetical's brackets, so the stored text has none.
    out.push({ element, text: element === "parenthetical" ? line.slice(1, -1).trim() : line });
  }
  return out;
}

/** The element a mark forces and the line without it, or null for a line that carries no mark. */
export function markedLine(raw: string): { element: ScreenplayElement; text: string } | null {
  const line = raw.trim();
  const element = MARK_ELEMENT[line.charAt(0)];
  if (!element) return null;
  let rest = line.slice(1);
  if (line.charAt(0) === ".") {
    // A forced heading starts with a letter: "..." is an ellipsis, ".5 seconds" is prose.
    if (!/^\p{L}/u.test(rest)) return null;
    return { element, text: rest.trim() };
  }
  rest = rest.trim();
  // Fountain's centered line, "> THE END <", is just a line of action here.
  const centered = line.charAt(0) === ">" && rest.endsWith("<");
  if (centered) rest = rest.slice(0, -1).trim();
  // "!!" and "@ " are not elements.
  if (!/[\p{L}\p{N}]/u.test(rest)) return null;
  return { element: centered ? "action" : element, text: rest };
}

const isSpeech = (el?: ScreenplayElement) => el === "character" || el === "parenthetical" || el === "dialogue";

/**
 * Script text from the assistant, sorted into elements. The assistant writes
 * marked lines (`.` heading, `!` action, `@` cue, `>` transition, `^` shot;
 * see SCRIPT_FORMAT), and a mark is believed: it is how an ALL-CAPS action line
 * stays action and an unusual cue stays a cue. Under a marked script, a line
 * after a cue, parenthetical or dialogue is a parenthetical or dialogue, never
 * a new cue guessed from its capitals. A line with no mark outside a speech, and
 * all of a text with no marks at all, falls back to `classifyScreenplayLines`.
 */
export function parseScriptLines(
  text: string,
  after?: ScreenplayElement
): { element: ScreenplayElement; text: string }[] {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => markedLine(line))) return classifyScreenplayLines(text, after);
  const out: { element: ScreenplayElement; text: string }[] = [];
  let previous: ScreenplayElement | undefined = after;
  // Unmarked lines outside a speech, classified together so a guessed cue still gets its dialogue.
  let run: string[] = [];
  let runAfter: ScreenplayElement | undefined;
  const settle = () => {
    if (run.length === 0) return;
    const rows = classifyScreenplayLines(run.join("\n"), runAfter);
    out.push(...rows);
    previous = rows[rows.length - 1]?.element;
    run = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      settle();
      previous = undefined;
      continue;
    }
    const marked = markedLine(line);
    if (marked) {
      settle();
      out.push(marked);
      previous = marked.element;
    } else if (run.length === 0 && isSpeech(previous)) {
      const parenthetical = /^\(\s*\S.*\)$/.test(line);
      previous = parenthetical ? "parenthetical" : "dialogue";
      // The page draws a parenthetical's brackets, so the stored text has none.
      out.push({ element: previous, text: parenthetical ? line.slice(1, -1).trim() : line });
    } else {
      if (run.length === 0) runAfter = previous;
      run.push(line);
    }
  }
  settle();
  return out;
}

/** A draft as the author reads it: the marks that drive `parseScriptLines` taken off, the text kept. */
export function scriptDisplayText(text: string): string {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => markedLine(line))) return text;
  return lines
    .map((line) => {
      const marked = markedLine(line);
      return marked ? marked.text : line;
    })
    .join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * How to read a replacement for a block tagged `replaced`: a replaced line of
 * speech keeps its speaker open (`after`); a replaced shot or centered line, or a
 * newer client's element this build does not know, is kept on the replacement's first line
 * (`keep`) rather than re-guessed; anything else starts fresh.
 */
export function replacementContext(replaced: string | undefined): { after?: ScreenplayElement; keep?: string } {
  if (replaced === "dialogue" || replaced === "parenthetical") return { after: "character" };
  if (replaced !== undefined && (replaced === "shot" || replaced === "centered" || !knownElement(replaced))) return { keep: replaced };
  return {};
}

/**
 * Replacement text for a block tagged `replaced`, sorted into elements. A kept
 * tag gives way only to a line that is plainly a scene heading or a transition.
 */
export function classifyReplacement(text: string, replaced: string | undefined): { element: string; text: string }[] {
  const { after, keep } = replacementContext(replaced);
  if (!keep) return parseScriptLines(text, after);
  const rows = text.split(/\r?\n/);
  const at = rows.findIndex((row) => row.trim());
  if (at < 0) return [];
  // A mark on the first line says what it is; only a plain line inherits the kept element.
  if (markedLine(rows[at])) return parseScriptLines(text);
  const [first] = classifyScreenplayLines(rows[at]);
  const head = first.element === "scene-heading" || first.element === "transition" ? first : { element: keep, text: first.text };
  const rest = rows.slice(at + 1).join("\n");
  return [head, ...parseScriptLines(rest, head === first ? first.element : normalizeElement(keep))];
}

/**
 * A replacement the assistant proposes as tracked suggestions, split into
 * blocks the way assistantTextToHtml places it. Undefined keeps the default.
 */
export function assistantReplacementSplitter(
  kind: ManuscriptKind
): ((replace: string, replacing: string | null) => { text: string; mark: (open: string) => string }[]) | undefined {
  if (kind !== "screenplay") return undefined;
  return (replace, replacing) => {
    // Marked lines say which blocks they are, so one line replaces its block rather than words in it.
    const explicit = replace.split(/\r?\n/).some((line) => markedLine(line) !== null);
    return classifyReplacement(replace, replacing ? elementTagOfHtml(replacing) : undefined).map(
      ({ element, text }) => ({
        text,
        mark: (open: string) => withElement(open, element),
        ...(explicit ? { explicit } : null),
      })
    );
  };
}

function screenplayHtml(lines: { element: string; text: string }[]): string {
  return lines.map(({ element, text }) => withElement(`<p>${escapeHtml(text)}</p>`, element)).join("");
}

/**
 * Text from the assistant that replaces a run of blocks starting on one tagged
 * `replaced`, as editor blocks.
 */
export function assistantReplacementToHtml(text: string, kind: ManuscriptKind, replaced: string | undefined): string {
  return kind === "screenplay" ? screenplayHtml(classifyReplacement(text, replaced)) : assistantTextToHtml(text, kind);
}

/**
 * Plain text from the assistant as editor blocks. A screenplay gets one
 * element per line, read on from the element of the block before (`after`);
 * anything else gets a paragraph per blank-line break.
 */
export function assistantTextToHtml(text: string, kind: ManuscriptKind, after?: ScreenplayElement): string {
  if (kind === "screenplay") {
    return screenplayHtml(parseScriptLines(text, after));
  }
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
