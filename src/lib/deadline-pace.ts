/**
 * Whether a manuscript's deadline is within reach, worked out from how much the
 * author has been writing lately. Shared by the server, the desk and the phone;
 * the Expo app cannot import from the Next app, so apps/mobile/lib/deadline-pace.ts
 * is a byte-for-byte copy and test/deadline-pace-parity fails when they drift.
 * No imports, no I/O, no AI: the same words and dates always give the same answer.
 *
 * The comparison is the words a day the deadline still asks for against the
 * words a day the author wrote across the last `PACE_WINDOW_DAYS` finished days.
 * Today is left out of the average (it is only part written) but its words are
 * already in `manuscriptWords`, so they still shorten the road.
 */

export const PACE_WINDOW_DAYS = 14;
/** Writing at least this many times the needed pace reads as comfortably ahead. */
export const AHEAD_RATIO = 1.25;
/** Writing under this share of the needed pace reads as needing to pick it up. */
export const BEHIND_RATIO = 0.85;

export type DeadlineStatus =
  /** The target is met. */
  | "complete"
  /** The date has passed with words to go. */
  | "pastDue"
  /** Recent pace is well over what is needed. */
  | "ahead"
  /** Recent pace covers what is needed. */
  | "onTrack"
  /** Recent pace falls short of what is needed. */
  | "behind"
  /** No words in the window yet, so there is nothing to compare. */
  | "gettingStarted";

export type WritingDayWords = { date: string; words: number };

export type DeadlineSnapshot = {
  status: DeadlineStatus;
  wordGoal: number;
  manuscriptWords: number;
  remaining: number;
  /** Words written over the target, 0 to 1. */
  progress: number;
  /** Days left to write in, today included; 0 once the date has passed. */
  daysLeft: number;
  /** Words a day still needed to land on the date; null once past due or complete. */
  neededPerDay: number | null;
  /** Words a day over the window; null when there is no window to average. */
  recentPerDay: number | null;
};

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** `date` moved by `delta` calendar days, as YYYY-MM-DD. */
export function addDays(date: string, delta: number): string {
  return new Date((dayNumber(date) + delta) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The average words a day over the finished days in the window before `today`.
 * The window starts at the author's first written day inside it, so a new
 * writer's few days are not watered down by a fortnight they were not here for.
 * Null when `today` leaves no finished day to average; 0 when nothing was written.
 */
export function recentWordsPerDay(days: readonly WritingDayWords[], today: string): number | null {
  const windowStart = addDays(today, -PACE_WINDOW_DAYS);
  const yesterday = addDays(today, -1);
  let first: string | null = null;
  let total = 0;
  for (const day of days) {
    if (day.date < windowStart || day.date > yesterday || day.words <= 0) continue;
    total += day.words;
    if (first === null || day.date < first) first = day.date;
  }
  if (first === null) return 0;
  return total / (daysBetween(first, yesterday) + 1);
}

export function deadlineSnapshot(input: {
  wordGoal: number;
  /** YYYY-MM-DD, inclusive: the author can still write on that day. */
  deadline: string;
  manuscriptWords: number;
  /** The author's days of writing, any range; only the window before `today` is read. */
  days: readonly WritingDayWords[];
  /** The author's local day, YYYY-MM-DD. */
  today: string;
}): DeadlineSnapshot {
  const words = Math.max(0, Math.floor(input.manuscriptWords));
  const remaining = Math.max(0, input.wordGoal - words);
  const progress = input.wordGoal > 0 ? Math.min(1, words / input.wordGoal) : 0;
  const daysLeft = Math.max(0, daysBetween(input.today, input.deadline) + 1);
  const base = { wordGoal: input.wordGoal, manuscriptWords: words, remaining, progress, daysLeft };

  if (remaining === 0) {
    return { ...base, status: "complete", neededPerDay: null, recentPerDay: null };
  }
  if (daysLeft === 0) {
    return { ...base, status: "pastDue", neededPerDay: null, recentPerDay: null };
  }

  const needed = remaining / daysLeft;
  const neededPerDay = Math.ceil(needed);
  const recent = recentWordsPerDay(input.days, input.today);
  if (recent === null || recent === 0) {
    return { ...base, status: "gettingStarted", neededPerDay, recentPerDay: null };
  }

  const ratio = recent / needed;
  const status: DeadlineStatus = ratio >= AHEAD_RATIO ? "ahead" : ratio >= BEHIND_RATIO ? "onTrack" : "behind";
  return { ...base, status, neededPerDay, recentPerDay: Math.round(recent) };
}

/** The round numbers a first target is offered from. */
const TARGET_STEPS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 75_000, 80_000, 100_000] as const;

/** A first target to offer: the smallest round number above the words already written. */
export function suggestedWordGoal(manuscriptWords: number): number {
  const words = Math.max(0, Math.floor(manuscriptWords));
  const step = TARGET_STEPS.find((candidate) => candidate > words);
  if (step) return step;
  return (Math.floor(words / 50_000) + 1) * 50_000;
}
