// Shapes and pure rules for the "Previously on" recap and the "I'm stuck"
// prompts. Client-safe: the Next app and (by copy of the rules) the phone use
// the same numbers.

export type Recap = {
  text: string;
  generatedAt: string;
};

export type RecapResponse = { recap: Recap | null };
export type StuckResponse = { prompts: string[] };

/** Away at least this long and the recap greets the author on open. */
export const RECAP_ABSENCE_MS = 12 * 60 * 60 * 1000;
/** Fewer words than this across the manuscript and there is nothing to recap. */
export const RECAP_MIN_WORDS = 100;
export const STUCK_PROMPTS_MAX = 4;

/**
 * Show the recap when the author has opened this manuscript before and has been
 * away long enough. A first open has nothing to recap.
 */
export function shouldShowRecap(lastOpenedAt: number | null, now: number): boolean {
  if (lastOpenedAt == null || !Number.isFinite(lastOpenedAt)) return false;
  return now - lastOpenedAt >= RECAP_ABSENCE_MS;
}

/** Small stable hash (djb2) so equal inputs share a cache row. */
export function fingerprintText(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return `${input.length}:${(hash >>> 0).toString(36)}`;
}

/** Pull prompt strings out of a model reply; tolerant of code fences and prose. */
export function parseStuckPrompts(raw: string): string[] {
  const trimmed = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let list: unknown = null;
  try {
    list = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        list = JSON.parse(match[0]);
      } catch {
        list = null;
      }
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const prompt = item.trim();
    if (prompt && !out.includes(prompt)) out.push(prompt);
    if (out.length >= STUCK_PROMPTS_MAX) break;
  }
  return out;
}
