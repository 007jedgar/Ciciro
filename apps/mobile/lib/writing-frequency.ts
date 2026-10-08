import { FREQ_DELETE_MS, FREQ_TYPE_MS } from "./motion";
import { shiftWritingDayKey, type WritingDayTotals } from "./writing-day";

/**
 * How often the writer has written, as a calm count: the number of days with
 * at least one word in the current calendar week, month and year. Never a run
 * of consecutive days, and a quiet period is skipped rather than reported.
 */
export type FrequencyPeriod = "week" | "month" | "year";
export type FrequencyEntry = { period: FrequencyPeriod; count: number };

const PERIOD_ORDER: readonly FrequencyPeriod[] = ["week", "month", "year"];

function parseDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The Monday of `date`'s week, as a day key. Weeks run Monday to Sunday (ISO 8601). */
export function startOfWritingWeek(date: string): string {
  const day = parseDay(date).getDay(); // 0 = Sunday
  return shiftWritingDayKey(date, -((day + 6) % 7));
}

/** Days with words > 0 from the start of the week / month / year through `today`. */
export function countWritingFrequency(
  days: ReadonlyArray<Pick<WritingDayTotals, "date" | "words">>,
  today: string
): Record<FrequencyPeriod, number> {
  const weekFrom = startOfWritingWeek(today);
  const monthFrom = `${today.slice(0, 7)}-01`;
  const yearFrom = `${today.slice(0, 4)}-01-01`;
  const counts = { week: 0, month: 0, year: 0 };
  for (const day of days) {
    if (day.words <= 0 || day.date > today) continue;
    if (day.date >= weekFrom) counts.week += 1;
    if (day.date >= monthFrom) counts.month += 1;
    if (day.date >= yearFrom) counts.year += 1;
  }
  return counts;
}

/** The periods worth saying, in week, month, year order. A period with nothing in it is left out. */
export function frequencyEntries(counts: Record<FrequencyPeriod, number>): FrequencyEntry[] {
  return PERIOD_ORDER.filter((period) => counts[period] > 0).map((period) => ({ period, count: counts[period] }));
}

/** One piece of the translated sentence: fixed text, or the slot for the count or the period. */
export type SentencePart = { kind: "text" | "count" | "period"; text: string };

export const COUNT_SLOT = "";
export const PERIOD_SLOT = "";

/**
 * Splits a translated sentence into its fixed text and its two slots. The
 * template is translated with private-use markers where the count and period
 * go, because the slots can sit in either order (Chinese leads with the period).
 */
export function splitSentence(template: string): SentencePart[] {
  const parts: SentencePart[] = [];
  let rest = template;
  while (rest.length > 0) {
    const next = [COUNT_SLOT, PERIOD_SLOT]
      .map((marker) => ({ marker, at: rest.indexOf(marker) }))
      .filter((hit) => hit.at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    if (!next) {
      parts.push({ kind: "text", text: rest });
      break;
    }
    if (next.at > 0) parts.push({ kind: "text", text: rest.slice(0, next.at) });
    parts.push({ kind: next.marker === COUNT_SLOT ? "count" : "period", text: "" });
    rest = rest.slice(next.at + 1);
  }
  return parts;
}

export type TypeStep = { text: string; delayMs: number };

/** The pause between the last deleted letter and the first typed one. */
export const FREQ_TURN_MS = 90;

/**
 * The frames of a slot changing from `from` to `to`: the old text is deleted a
 * letter at a time, a beat passes, the new text is typed a letter at a time.
 * Each step is the text to show and how long to wait before showing it.
 */
export function typewriterSteps(from: string, to: string): TypeStep[] {
  if (from === to) return [];
  const steps: TypeStep[] = [];
  for (let end = from.length - 1; end >= 0; end -= 1) {
    steps.push({ text: from.slice(0, end), delayMs: FREQ_DELETE_MS });
  }
  for (let end = 1; end <= to.length; end += 1) {
    steps.push({ text: to.slice(0, end), delayMs: end === 1 ? FREQ_TURN_MS : FREQ_TYPE_MS });
  }
  return steps;
}
