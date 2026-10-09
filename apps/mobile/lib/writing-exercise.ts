// The guided writing exercise: Observe, React, Narrate. Pure pieces only (the
// script, the clocks, the text it leaves behind); the screen is
// app/writing-exercise.tsx. Nothing here talks to a server or an AI.

export const EXERCISE_ID = "observe_react_narrate";

/** The three parts, in order. A part's guide line and name are `exercise.parts.<id>.*`. */
export const EXERCISE_PARTS = ["observe", "react", "narrate"] as const;
export type ExercisePart = (typeof EXERCISE_PARTS)[number];

export type ExerciseTexts = Record<ExercisePart, string>;

export const EMPTY_TEXTS: ExerciseTexts = { observe: "", react: "", narrate: "" };

/** The senses the settle-in walks through before the page opens, in order. */
export const SETTLE_PROMPTS = ["look", "listen", "smell", "feel"] as const;
export type SettlePrompt = (typeof SETTLE_PROMPTS)[number];

/** How long each sense holds the screen: four of them make the 48 second settle-in. */
export const SETTLE_PROMPT_MS = 12_000;
export const SETTLE_MS = SETTLE_PROMPT_MS * SETTLE_PROMPTS.length;

/** The soft timer on each writing part (the brief is five to ten minutes). Nothing locks when it runs out. */
export const PART_MINUTES = 7;
export const PART_MS = PART_MINUTES * 60_000;

/** Which sense is on screen `elapsedMs` into the settle-in (the last one holds until the end). */
export function settlePromptAt(elapsedMs: number): SettlePrompt {
  const index = Math.floor(Math.max(0, elapsedMs) / SETTLE_PROMPT_MS);
  return SETTLE_PROMPTS[Math.min(SETTLE_PROMPTS.length - 1, index)];
}

/** How far through a span `elapsedMs` is, 0 to 1. */
export function fractionOf(elapsedMs: number, totalMs: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs / totalMs));
}

/** The part after `part`, or null after the last. */
export function nextPart(part: ExercisePart): ExercisePart | null {
  return EXERCISE_PARTS[EXERCISE_PARTS.indexOf(part) + 1] ?? null;
}

/** The parts written before `part`, which the page shows above its own. */
export function partsBefore(part: ExercisePart): ExercisePart[] {
  return EXERCISE_PARTS.slice(0, EXERCISE_PARTS.indexOf(part));
}

export function exerciseWordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

export function totalWords(texts: ExerciseTexts): number {
  return EXERCISE_PARTS.reduce((sum, part) => sum + exerciseWordCount(texts[part]), 0);
}

/** True once any part has something in it, so leaving would lose writing. */
export function hasWriting(texts: ExerciseTexts): boolean {
  return EXERCISE_PARTS.some((part) => texts[part].trim().length > 0);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One paragraph per non-empty line, the editor's own shape for plain text. */
function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The result as a chapter: a heading per part, then that part's paragraphs. */
export function exerciseHtml(texts: ExerciseTexts, labels: Record<ExercisePart, string>): string {
  return EXERCISE_PARTS.map((part) => {
    const body = paragraphs(texts[part])
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join("");
    return `<h2>${escapeHtml(labels[part])}</h2>${body}`;
  }).join("");
}

/** The result as plain text to copy out: each part's name, then its lines, parts split by a blank line. */
export function exerciseCopyText(texts: ExerciseTexts, labels: Record<ExercisePart, string>): string {
  return EXERCISE_PARTS.map((part) => `${labels[part]}\n\n${paragraphs(texts[part]).join("\n\n")}`.trimEnd()).join(
    "\n\n\n"
  );
}
