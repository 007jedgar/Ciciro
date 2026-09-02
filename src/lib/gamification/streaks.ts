import {
  FREEZE_EVERY_CLOSED_DAYS,
  GRACE_WINDOW_DAYS,
  MAX_EARNED_FREEZES,
} from "./constants";
import { addLocalDays, daysBetween } from "./time";

export type StreakSnapshot = {
  current: number;
  best: number;
  earnedFreezes: number;
  closedScheduledDays: number;
  lastGraceLocalDate: string | null;
  lastClosedLocalDate: string | null;
  lastEvaluatedLocalDate: string | null;
};

export type StreakEvent = {
  date: string;
  kind: "closed" | "grace" | "freeze" | "reset";
};

export type StreakEvalResult = {
  state: StreakSnapshot;
  events: StreakEvent[];
};

function clone(state: StreakSnapshot): StreakSnapshot {
  return { ...state };
}

function graceAvailable(lastGrace: string | null, missDate: string): boolean {
  if (!lastGrace) return true;
  return daysBetween(lastGrace, missDate) >= GRACE_WINDOW_DAYS;
}

function closeDay(state: StreakSnapshot, date: string, events: StreakEvent[]): void {
  state.current += 1;
  if (state.current > state.best) state.best = state.current;
  state.closedScheduledDays += 1;
  if (
    state.closedScheduledDays > 0 &&
    state.closedScheduledDays % FREEZE_EVERY_CLOSED_DAYS === 0
  ) {
    state.earnedFreezes = Math.min(MAX_EARNED_FREEZES, state.earnedFreezes + 1);
  }
  state.lastClosedLocalDate = date;
  events.push({ date, kind: "closed" });
}

function applyMiss(state: StreakSnapshot, date: string, events: StreakEvent[]): void {
  if (graceAvailable(state.lastGraceLocalDate, date)) {
    state.lastGraceLocalDate = date;
    state.lastClosedLocalDate = date;
    events.push({ date, kind: "grace" });
    return;
  }
  if (state.earnedFreezes > 0) {
    state.earnedFreezes -= 1;
    state.lastClosedLocalDate = date;
    events.push({ date, kind: "freeze" });
    return;
  }
  state.current = 0;
  events.push({ date, kind: "reset" });
}

/**
 * Recovery-first Return streak. Unscheduled days are not misses. Today is not
 * judged a miss until a later local day evaluates it. Pause skips evaluation.
 */
export function evaluateReturnStreak(input: {
  state: StreakSnapshot;
  today: string;
  isScheduled: (localDate: string) => boolean;
  isClosed: (localDate: string) => boolean;
  paused: boolean;
}): StreakEvalResult {
  const state = clone(input.state);
  const events: StreakEvent[] = [];

  if (input.paused) {
    state.lastEvaluatedLocalDate = input.today;
    return { state, events };
  }

  const start = input.state.lastEvaluatedLocalDate ?? input.today;

  if (daysBetween(start, input.today) < 0) {
    return { state, events };
  }

  let cursor = start;
  while (daysBetween(cursor, input.today) >= 0) {
    if (input.isScheduled(cursor)) {
      const alreadySettled = state.lastClosedLocalDate === cursor;
      if (input.isClosed(cursor)) {
        if (!alreadySettled) closeDay(state, cursor, events);
      } else if (cursor !== input.today && !alreadySettled) {
        applyMiss(state, cursor, events);
      }
    }
    cursor = addLocalDays(cursor, 1);
  }

  state.lastEvaluatedLocalDate = input.today;
  return { state, events };
}

export function emptyStreak(): StreakSnapshot {
  return {
    current: 0,
    best: 0,
    earnedFreezes: 0,
    closedScheduledDays: 0,
    lastGraceLocalDate: null,
    lastClosedLocalDate: null,
    lastEvaluatedLocalDate: null,
  };
}
