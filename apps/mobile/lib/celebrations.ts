import { getPrefs } from "./prefs";

/**
 * The once-a-day "you reached your goal" moment is remembered on the device,
 * per account: the last day it played. One value per account is enough since
 * the moment is once per day, and an old day's key never builds up.
 */
function goalKey(userId: string): string {
  return `goal-celebrated:${userId}`;
}

/** Whether today's goal moment already played for this account on this device. */
export function hasCelebratedGoal(userId: string, date: string): boolean {
  try {
    return getPrefs().getString(goalKey(userId)) === date;
  } catch {
    // No prefs (tests, web): treat it as played so the moment never loops.
    return true;
  }
}

export function markGoalCelebrated(userId: string, date: string): void {
  try {
    getPrefs().set(goalKey(userId), date);
  } catch {
    /* no prefs: skipped */
  }
}

/**
 * A manuscript's deadline target is celebrated once per target, not per day: the
 * stored value is the word target it last played for, so raising the target and
 * meeting it again plays again. Per account and manuscript, on this device.
 */
function deadlineKey(userId: string, projectId: string): string {
  return `deadline-celebrated:${userId}:${projectId}`;
}

export function hasCelebratedDeadline(userId: string, projectId: string, wordGoal: number): boolean {
  try {
    return getPrefs().getString(deadlineKey(userId, projectId)) === String(wordGoal);
  } catch {
    // No prefs (tests, web): treat it as played so the moment never loops.
    return true;
  }
}

export function markDeadlineCelebrated(userId: string, projectId: string, wordGoal: number): void {
  try {
    getPrefs().set(deadlineKey(userId, projectId), String(wordGoal));
  } catch {
    /* no prefs: skipped */
  }
}
