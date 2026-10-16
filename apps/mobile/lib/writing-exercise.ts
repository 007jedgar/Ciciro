// The guided writing exercises: a small registry of them (each a list of timed
// parts and an optional settle-in) and the pure pieces they share (the clocks,
// the text one leaves behind). The screen is app/writing-exercise.tsx. Nothing
// here talks to a server or an AI.
//
// An exercise is data: adding one is an entry in `EXERCISES` plus its copy
// under `exercise.items.<id>` in every locale (title, tagline, intro, and for
// each part a name, blurb, guide, placeholder and label), never a new screen.

/** In the order the picker lists them. A stored or tracked id is permanent, like a theme's. */
export const EXERCISE_IDS = [
  "observe_react_narrate",
  "pour_it_out",
  "one_true_sentence",
  "terrible_first_draft",
  "noun_list",
] as const;
export type ExerciseId = (typeof EXERCISE_IDS)[number];

export function isExerciseId(value: unknown): value is ExerciseId {
  return typeof value === "string" && (EXERCISE_IDS as readonly string[]).includes(value);
}

/** One writing part: its id (the key of its copy and of its text) and its soft clock in minutes, which never locks anything when it runs out. */
export type ExercisePartDef = { id: string; minutes: number };

/** The pause before the first part: a line at a time (`exercise.items.<id>.settle.prompts.<prompt>`), each held for `promptMs`. */
export type ExerciseSettleDef = { prompts: readonly string[]; promptMs: number };

export type ExerciseDef = {
  id: ExerciseId;
  parts: readonly ExercisePartDef[];
  settle: ExerciseSettleDef | null;
  /**
   * Whether it follows a named writer's practice, so `exercise.items.<id>.credit`
   * names them. Only for an attribution that holds up: Ciciro's own sensory
   * exercise has none.
   */
  credited: boolean;
};

/** Four senses, 48 seconds: the page stays shut while the writer arrives in the room. */
const SENSES: ExerciseSettleDef = { prompts: ["look", "listen", "smell", "feel"], promptMs: 12_000 };
/** A shorter breath before an unfiltered page. */
const EXHALE: ExerciseSettleDef = { prompts: ["breathe", "letGo", "begin"], promptMs: 7_000 };

export const EXERCISES: readonly ExerciseDef[] = [
  {
    id: "observe_react_narrate",
    settle: SENSES,
    credited: false,
    parts: [
      { id: "observe", minutes: 7 },
      { id: "react", minutes: 7 },
      { id: "narrate", minutes: 7 },
    ],
  },
  {
    // Julia Cameron's Morning Pages, Peter Elbow's freewriting, Natalie Goldberg's writing practice.
    id: "pour_it_out",
    settle: EXHALE,
    credited: true,
    parts: [{ id: "pages", minutes: 10 }],
  },
  {
    // Hemingway: "one true sentence" (A Moveable Feast) and stopping while you still know what comes next (The Paris Review, 1958).
    id: "one_true_sentence",
    settle: null,
    credited: true,
    parts: [
      { id: "sentence", minutes: 2 },
      { id: "onward", minutes: 5 },
      { id: "stop", minutes: 2 },
    ],
  },
  {
    // Anne Lamott, "Shitty First Drafts" (Bird by Bird).
    id: "terrible_first_draft",
    settle: null,
    credited: true,
    parts: [
      { id: "terrible", minutes: 5 },
      { id: "keeper", minutes: 3 },
    ],
  },
  {
    // Ray Bradbury's lists of nouns (Zen in the Art of Writing).
    id: "noun_list",
    settle: null,
    credited: true,
    parts: [
      { id: "list", minutes: 3 },
      { id: "pull", minutes: 7 },
    ],
  },
];

export function exerciseById(id: unknown): ExerciseDef | null {
  return EXERCISES.find((exercise) => exercise.id === id) ?? null;
}

/** The text of each part by part id. */
export type ExerciseTexts = Record<string, string>;

export function emptyTexts(exercise: ExerciseDef): ExerciseTexts {
  return Object.fromEntries(exercise.parts.map((part) => [part.id, ""]));
}

export function partMs(part: ExercisePartDef): number {
  return part.minutes * 60_000;
}

/** The minutes the writing parts add up to, for "about N minutes" (the settle-in is a pause, not part of it). */
export function exerciseMinutes(exercise: ExerciseDef): number {
  return exercise.parts.reduce((sum, part) => sum + part.minutes, 0);
}

export function settleMs(settle: ExerciseSettleDef): number {
  return settle.prompts.length * settle.promptMs;
}

/** Which line is on screen `elapsedMs` into the settle-in (the last one holds until the end). */
export function settlePromptAt(settle: ExerciseSettleDef, elapsedMs: number): string {
  const index = Math.floor(Math.max(0, elapsedMs) / settle.promptMs);
  return settle.prompts[Math.min(settle.prompts.length - 1, index)]!;
}

/** How far through a span `elapsedMs` is, 0 to 1. */
export function fractionOf(elapsedMs: number, totalMs: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs / totalMs));
}

/** The part after `partId`, or null after the last. */
export function nextPart(exercise: ExerciseDef, partId: string): ExercisePartDef | null {
  const at = exercise.parts.findIndex((part) => part.id === partId);
  return at < 0 ? null : (exercise.parts[at + 1] ?? null);
}

/** The parts written before `partId`, which the page shows above its own. */
export function partsBefore(exercise: ExerciseDef, partId: string): ExercisePartDef[] {
  const at = exercise.parts.findIndex((part) => part.id === partId);
  return at < 0 ? [] : exercise.parts.slice(0, at);
}

export function exerciseWordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

export function totalWords(exercise: ExerciseDef, texts: ExerciseTexts): number {
  return exercise.parts.reduce((sum, part) => sum + exerciseWordCount(texts[part.id] ?? ""), 0);
}

/** True once any part has something in it, so leaving would lose writing. */
export function hasWriting(exercise: ExerciseDef, texts: ExerciseTexts): boolean {
  return exercise.parts.some((part) => (texts[part.id] ?? "").trim().length > 0);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One paragraph per non-empty line, the editor's own shape for plain text. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Whether the result names its parts. An exercise of one part is just a page,
 * so what it leaves behind has no heading to repeat the title.
 */
export function namesParts(exercise: ExerciseDef): boolean {
  return exercise.parts.length > 1;
}

/** The result as a chapter: a heading per part (when it has several), then that part's paragraphs. */
export function exerciseHtml(exercise: ExerciseDef, texts: ExerciseTexts, labels: Record<string, string>): string {
  const headed = namesParts(exercise);
  return exercise.parts
    .map((part) => {
      const body = paragraphs(texts[part.id] ?? "")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
      return `${headed ? `<h2>${escapeHtml(labels[part.id] ?? part.id)}</h2>` : ""}${body}`;
    })
    .join("");
}

/** The result as plain text to copy out: each part's name (when it has several), then its lines, parts split by a blank line. */
export function exerciseCopyText(exercise: ExerciseDef, texts: ExerciseTexts, labels: Record<string, string>): string {
  const headed = namesParts(exercise);
  return exercise.parts
    .map((part) => {
      const body = paragraphs(texts[part.id] ?? "").join("\n\n");
      return headed ? `${labels[part.id] ?? part.id}\n\n${body}`.trimEnd() : body;
    })
    .join("\n\n\n");
}
