// What kind of writing a manuscript is. "novel" is the original behavior and
// the default for every manuscript created before kinds existed.
//
// Must stay in step with src/lib/manuscript-kind.ts (test/manuscript-kind.test.ts
// checks the two agree). The assistant prompts live only on the server.

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
