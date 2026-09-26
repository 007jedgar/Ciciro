// What kind of writing a manuscript is. "novel" is the original behavior and
// the default for every manuscript created before kinds existed.
//
// Must stay in step with apps/mobile/lib/manuscript-kind.ts (test/manuscript-kind.test.ts
// checks the two agree).

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

export const SCREENPLAY_ELEMENTS = [
  "scene-heading",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
] as const;
export type ScreenplayElement = (typeof SCREENPLAY_ELEMENTS)[number];

export const SCREENPLAY_ELEMENT_LABELS: Record<ScreenplayElement, string> = {
  "scene-heading": "Scene heading",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
};

export const SCREENPLAY_ATTR = "data-sp";

export function isScreenplayElement(value: unknown): value is ScreenplayElement {
  return typeof value === "string" && (SCREENPLAY_ELEMENTS as readonly string[]).includes(value);
}

/** A block with no element is action, the screenplay default. */
export function normalizeElement(value: unknown): ScreenplayElement {
  return isScreenplayElement(value) ? value : "action";
}

/** Tab walks this ring; Shift-Tab walks it backwards. */
const CYCLE: readonly ScreenplayElement[] = [
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
  "scene-heading",
];

export function cycleElement(current: ScreenplayElement, direction: 1 | -1 = 1): ScreenplayElement {
  const at = CYCLE.indexOf(current);
  return CYCLE[(at + direction + CYCLE.length) % CYCLE.length];
}

const AFTER_ENTER: Record<ScreenplayElement, ScreenplayElement> = {
  "scene-heading": "action",
  action: "action",
  character: "dialogue",
  dialogue: "action",
  parenthetical: "dialogue",
  transition: "scene-heading",
};

/** The element a new block takes when Enter splits or ends `current`. */
export function nextElementOnEnter(current: ScreenplayElement): ScreenplayElement {
  return AFTER_ENTER[current];
}

/** Read the element off a block's opening tag. */
export function elementOfHtml(html: string): ScreenplayElement {
  const opening = html.match(/^<[a-z][\w-]*\b([^>]*)>/i)?.[1] ?? "";
  const m = opening.match(/\bdata-sp\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return normalizeElement(m?.[1] ?? m?.[2] ?? m?.[3]);
}

/** Set (or, for action, clear) the element on a block's opening tag. */
export function withElement(html: string, element: ScreenplayElement): string {
  return html.replace(/^<([a-z][\w-]*)\b([^>]*)>/i, (_full, tag: string, attrs: string) => {
    const bare = attrs.replace(/\s*\bdata-sp\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    return element === "action" ? `<${tag}${bare}>` : `<${tag}${bare} ${SCREENPLAY_ATTR}="${element}">`;
  });
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

// --- AI assistant ------------------------------------------------------------

const DIRECTIVES: Record<ManuscriptKind, string> = {
  novel: "",
  screenplay: `# This manuscript is a SCREENPLAY, not a novel
Treat every "chapter" as a sequence of scenes and every "draft" as script pages.
- Write in standard screenplay form: SCENE HEADINGS (INT./EXT. LOCATION - TIME),
  action in present tense and lean, CHARACTER cues in caps, dialogue beneath them,
  parentheticals only when the delivery would otherwise be unclear, transitions
  (CUT TO:, FADE OUT.) sparingly.
- Format prose you place with one block per line and lead with the element, e.g.
  a scene heading line, then an action line, then the character name, then the
  dialogue. Never write novel-style narration, interiority, or camera-free
  description that cannot be filmed.
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
  screenplay: `The piece is a screenplay. Return script pages in standard format, one element per
line: scene headings (INT./EXT. LOCATION - TIME), lean present-tense action, CHARACTER
names in caps above their dialogue, and parentheticals only where needed. No novel
narration.`,
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

/**
 * Sort a script written as plain lines (what the assistant returns) into
 * screenplay elements. A line under a character cue is dialogue until a blank
 * line; anything unrecognized is action.
 */
export function classifyScreenplayLines(text: string): { element: ScreenplayElement; text: string }[] {
  const out: { element: ScreenplayElement; text: string }[] = [];
  let inDialogue = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      inDialogue = false;
      continue;
    }
    let element: ScreenplayElement;
    if (SCENE_HEADING.test(line)) element = "scene-heading";
    else if (TRANSITION.test(line)) element = "transition";
    else if (inDialogue && /^\(.*\)$/.test(line)) element = "parenthetical";
    else if (inDialogue) element = "dialogue";
    else if (CHARACTER_CUE.test(line) && line === line.toUpperCase()) element = "character";
    else element = "action";
    inDialogue = element === "character" || element === "parenthetical" || element === "dialogue";
    out.push({ element, text: line });
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Plain text from the assistant as editor blocks. A screenplay gets one
 * element per line; anything else gets a paragraph per blank-line break.
 */
export function assistantTextToHtml(text: string, kind: ManuscriptKind): string {
  if (kind === "screenplay") {
    return classifyScreenplayLines(text)
      .map(({ element, text: line }) => withElement(`<p>${escapeHtml(line)}</p>`, element))
      .join("");
  }
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
