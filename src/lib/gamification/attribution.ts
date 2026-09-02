import { diffArrays } from "diff";
import { countWords } from "@/lib/text";
import {
  HUMAN_WPM_CAP,
  MIN_CHAIR_MINUTES_FOR_CAP,
  PASTE_WORD_THRESHOLD,
  type SaveSource,
} from "./constants";

export type InputMeta = {
  typedChars?: number;
  pastedChars?: number;
  compositionMs?: number;
};

export type AttributionResult = {
  addedWords: number;
  removedWords: number;
  humanTyped: number;
  aiInserted: number;
  pasted: number;
  editorMutated: number;
  uncappedIgnored: number;
};

function tokenize(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  return t.split(/\s+/);
}

/** Token-level added/removed counts (not only a wordCount delta). */
export function wordDiff(prevText: string, nextText: string): {
  added: number;
  removed: number;
} {
  const parts = diffArrays(tokenize(prevText), tokenize(nextText));
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.added) added += part.value.length;
    else if (part.removed) removed += part.value.length;
  }
  return { added, removed };
}

function estimatedWordsFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.max(1, Math.round(chars / 5));
}

/**
 * Classify manuscript growth for habit goals. Chat never counts. AI inserts
 * and large pastes are not Prose. Human-typed words are capped at ~80 WPM vs
 * chair time so a dump cannot mint a writing day.
 */
export function attributeSave(input: {
  prevText: string;
  nextText: string;
  source?: SaveSource;
  inputMeta?: InputMeta;
  chairMinutes: number;
  humanTypedAlreadyToday: number;
}): AttributionResult {
  const empty: AttributionResult = {
    addedWords: 0,
    removedWords: 0,
    humanTyped: 0,
    aiInserted: 0,
    pasted: 0,
    editorMutated: 0,
    uncappedIgnored: 0,
  };

  const source = input.source ?? "human";
  if (source === "chat") return empty;

  const { added, removed } = wordDiff(input.prevText, input.nextText);
  if (added <= 0 && removed <= 0) return empty;

  const result: AttributionResult = {
    ...empty,
    addedWords: added,
    removedWords: removed,
  };

  if (added <= 0) return result;

  if (source === "autowrite" || source === "draft_insert") {
    result.aiInserted = added;
    return result;
  }
  if (source === "editor_mutate") {
    result.editorMutated = added;
    return result;
  }

  const pastedChars = input.inputMeta?.pastedChars ?? 0;
  const pastedEstimate = estimatedWordsFromChars(pastedChars);
  if (pastedEstimate > PASTE_WORD_THRESHOLD) {
    result.pasted = Math.min(added, pastedEstimate);
    const remainder = added - result.pasted;
    if (remainder > 0) {
      applyHumanCap(result, remainder, input.chairMinutes, input.humanTypedAlreadyToday);
    }
    return result;
  }

  applyHumanCap(result, added, input.chairMinutes, input.humanTypedAlreadyToday);
  return result;
}

function applyHumanCap(
  result: AttributionResult,
  candidate: number,
  chairMinutes: number,
  already: number
): void {
  const capMinutes = Math.max(chairMinutes, MIN_CHAIR_MINUTES_FOR_CAP);
  const room = Math.max(0, Math.floor(capMinutes * HUMAN_WPM_CAP) - already);
  result.humanTyped = Math.min(candidate, room);
  result.uncappedIgnored = candidate - result.humanTyped;
}

/** Words covered by a clipboard dump, for tests and inputMeta hints. */
export function pasteWordEstimate(text: string): number {
  return countWords(text);
}
