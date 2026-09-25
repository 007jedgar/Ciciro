import { writingDayKey, shiftWritingDayKey } from "./writing-day";

export const NANO_WORD_GOAL = 50_000;

export type ManuscriptTargetTotals = {
  projectId: string;
  wordGoal: number;
  /** YYYY-MM-DD inclusive deadline. */
  deadline: string;
};

export type ManuscriptPace = {
  remaining: number;
  daysLeft: number;
  /** Words needed today; null when past the deadline with words left (show remainder only). */
  pace: number | null;
  pastDeadline: boolean;
  complete: boolean;
};

/** NaNoWriMo: 50k by 30 November — this year if still ahead, otherwise next. */
export function nanoPreset(today = writingDayKey()): ManuscriptTargetTotals {
  const year = Number(today.slice(0, 4));
  const thisNov = `${year}-11-30`;
  const deadline = today <= thisNov ? thisNov : `${year + 1}-11-30`;
  return { projectId: "", wordGoal: NANO_WORD_GOAL, deadline };
}

export function daysLeftInclusive(today: string, deadline: string): number {
  if (today > deadline) return 0;
  let count = 0;
  let cursor = today;
  while (cursor <= deadline) {
    count += 1;
    cursor = shiftWritingDayKey(cursor, 1);
  }
  return count;
}

export function manuscriptPace(
  target: Pick<ManuscriptTargetTotals, "wordGoal" | "deadline">,
  manuscriptWords: number,
  today = writingDayKey()
): ManuscriptPace {
  const remaining = Math.max(0, target.wordGoal - Math.max(0, Math.floor(manuscriptWords)));
  const complete = remaining === 0;
  const daysLeft = daysLeftInclusive(today, target.deadline);
  const pastDeadline = today > target.deadline;
  if (complete) {
    return { remaining: 0, daysLeft: Math.max(daysLeft, 0), pace: 0, pastDeadline, complete: true };
  }
  if (pastDeadline || daysLeft === 0) {
    return { remaining, daysLeft: 0, pace: null, pastDeadline: true, complete: false };
  }
  return {
    remaining,
    daysLeft,
    pace: Math.ceil(remaining / daysLeft),
    pastDeadline: false,
    complete: false,
  };
}
