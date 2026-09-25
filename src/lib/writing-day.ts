export const PAUSE_MS = 30_000;
export const HEARTBEAT_MS = 2_000;
export const WRITING_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_HEARTBEAT_WORDS = 100_000;
export const MAX_HEARTBEAT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DAILY_WORD_GOAL = 250;
export const DAILY_WORD_GOAL_MIN = 50;
export const DAILY_WORD_GOAL_MAX = 10_000;
export const DEFAULT_WEEKLY_DAY_TARGET = 4;
export const WEEKLY_DAY_TARGET_MIN = 1;
export const WEEKLY_DAY_TARGET_MAX = 7;
export const ROLLING_WEEK_DAYS = 7;
export const ROLLING_MONTH_DAYS = 30;
/** Inclusive from/to span the range API will accept. */
export const MAX_WRITING_DAY_RANGE_DAYS = 4000;

export type WritingDayTotals = {
  date: string;
  words: number;
  activeMs: number;
};

export type WritingDaySnapshot = WritingDayTotals & {
  pendingWords: number;
  pendingActiveMs: number;
};

export type WritingHistoryTotals = {
  weekWords: number;
  monthWords: number;
  allTimeWords: number;
  bestDay: WritingDayTotals | null;
  daysInLast7: number;
  avgActiveMs: number | null;
};

/** Local calendar day in the device timezone. */
export function writingDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function clampDailyWordGoal(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DAILY_WORD_GOAL;
  return Math.min(DAILY_WORD_GOAL_MAX, Math.max(DAILY_WORD_GOAL_MIN, Math.round(n)));
}

export function clampWeeklyDayTarget(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WEEKLY_DAY_TARGET;
  return Math.min(
    WEEKLY_DAY_TARGET_MAX,
    Math.max(WEEKLY_DAY_TARGET_MIN, Math.round(n))
  );
}

function parseLocalDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Shift a YYYY-MM-DD key by `delta` calendar days in local time. */
export function shiftWritingDayKey(date: string, delta: number): string {
  const next = parseLocalDay(date);
  next.setDate(next.getDate() + delta);
  return writingDayKey(next);
}

/** Inclusive list of calendar keys from `from` through `to`. */
export function writingDayKeysInRange(from: string, to: string): string[] {
  if (from > to) return [];
  const keys: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    keys.push(cursor);
    cursor = shiftWritingDayKey(cursor, 1);
  }
  return keys;
}

/** Fill missing days in `[from, to]` with zero words / activeMs. */
export function bucketWritingDays(
  days: ReadonlyArray<Pick<WritingDayTotals, "date" | "words" | "activeMs">>,
  from: string,
  to: string
): WritingDayTotals[] {
  const byDate = new Map<string, Pick<WritingDayTotals, "words" | "activeMs">>();
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    const prev = byDate.get(day.date);
    if (prev) {
      byDate.set(day.date, {
        words: prev.words + day.words,
        activeMs: prev.activeMs + day.activeMs,
      });
    } else {
      byDate.set(day.date, { words: day.words, activeMs: day.activeMs });
    }
  }
  return writingDayKeysInRange(from, to).map((date) => {
    const row = byDate.get(date);
    return row
      ? { date, words: row.words, activeMs: row.activeMs }
      : { date, words: 0, activeMs: 0 };
  });
}

/** Prefer today's local snapshot (synced + pending) over the server row. */
export function overlayWritingDay(
  days: ReadonlyArray<WritingDayTotals>,
  overlay: WritingDayTotals
): WritingDayTotals[] {
  let found = false;
  const next = days.map((day) => {
    if (day.date !== overlay.date) return day;
    found = true;
    return {
      date: overlay.date,
      words: overlay.words,
      activeMs: overlay.activeMs,
    };
  });
  if (!found) next.push({ date: overlay.date, words: overlay.words, activeMs: overlay.activeMs });
  next.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return next;
}

export function sumWritingWords(
  days: ReadonlyArray<Pick<WritingDayTotals, "words">>
): number {
  let total = 0;
  for (const day of days) total += day.words;
  return total;
}

export function wordsInRollingWindow(
  days: ReadonlyArray<Pick<WritingDayTotals, "date" | "words">>,
  endDate: string,
  windowDays: number
): number {
  if (windowDays <= 0) return 0;
  const from = shiftWritingDayKey(endDate, -(windowDays - 1));
  let total = 0;
  for (const day of days) {
    if (day.date >= from && day.date <= endDate) total += day.words;
  }
  return total;
}

/** Days with words > 0 inside a rolling window ending on `endDate` (inclusive). */
export function countWritingDaysInWindow(
  days: ReadonlyArray<Pick<WritingDayTotals, "date" | "words">>,
  endDate: string,
  windowDays = ROLLING_WEEK_DAYS
): number {
  if (windowDays <= 0) return 0;
  const from = shiftWritingDayKey(endDate, -(windowDays - 1));
  let count = 0;
  for (const day of days) {
    if (day.date >= from && day.date <= endDate && day.words > 0) count += 1;
  }
  return count;
}

export function bestWritingDay(
  days: ReadonlyArray<WritingDayTotals>
): WritingDayTotals | null {
  let best: WritingDayTotals | null = null;
  for (const day of days) {
    if (day.words <= 0) continue;
    if (!best || day.words > best.words) best = day;
  }
  return best;
}

/** Mean activeMs across days that counted (words > 0). */
export function averageActiveMsPerWritingDay(
  days: ReadonlyArray<Pick<WritingDayTotals, "words" | "activeMs">>
): number | null {
  let sum = 0;
  let count = 0;
  for (const day of days) {
    if (day.words <= 0) continue;
    sum += day.activeMs;
    count += 1;
  }
  if (count === 0) return null;
  return Math.round(sum / count);
}

export function summarizeWritingHistory(
  days: ReadonlyArray<WritingDayTotals>,
  today: string
): WritingHistoryTotals {
  return {
    weekWords: wordsInRollingWindow(days, today, ROLLING_WEEK_DAYS),
    monthWords: wordsInRollingWindow(days, today, ROLLING_MONTH_DAYS),
    allTimeWords: sumWritingWords(days),
    bestDay: bestWritingDay(days),
    daysInLast7: countWritingDaysInWindow(days, today, ROLLING_WEEK_DAYS),
    avgActiveMs: averageActiveMsPerWritingDay(days),
  };
}

/** Human label for active typing time (time at the keys). */
export function formatActiveDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export function positiveWordDelta(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
  const delta = Math.floor(after) - Math.floor(before);
  return delta > 0 ? delta : 0;
}

/** Gap between keystrokes counts as active time until a pause longer than `pauseMs`. */
export function activeMsForStroke(lastAt: number | null, now: number, pauseMs = PAUSE_MS): number {
  if (lastAt == null) return 0;
  const gap = now - lastAt;
  if (gap <= 0 || gap > pauseMs) return 0;
  return gap;
}

export function mergeWritingDay(
  current: Pick<WritingDayTotals, "words" | "activeMs">,
  delta: Pick<WritingDayTotals, "words" | "activeMs">
): Pick<WritingDayTotals, "words" | "activeMs"> {
  return {
    words: current.words + delta.words,
    activeMs: current.activeMs + delta.activeMs,
  };
}

/** Same reference when totals are unchanged — required by useSyncExternalStore getSnapshot. */
export function holdWritingDaySnapshot(
  cached: WritingDayTotals | null,
  next: WritingDayTotals
): WritingDayTotals {
  if (
    cached &&
    cached.date === next.date &&
    cached.words === next.words &&
    cached.activeMs === next.activeMs
  ) {
    return cached;
  }
  return next;
}

export function parseWritingDayDate(value: unknown): string | { error: string } {
  if (typeof value !== "string" || !WRITING_DAY_RE.test(value)) {
    return { error: "date must be YYYY-MM-DD." };
  }
  return value;
}

export function parseWritingDayRange(
  fromValue: unknown,
  toValue: unknown
): { from: string; to: string } | { error: string } {
  const from = parseWritingDayDate(fromValue);
  if (typeof from !== "string") return { error: "from must be YYYY-MM-DD." };
  const to = parseWritingDayDate(toValue);
  if (typeof to !== "string") return { error: "to must be YYYY-MM-DD." };
  if (from > to) return { error: "from must be on or before to." };
  const spanMs = parseLocalDay(to).getTime() - parseLocalDay(from).getTime();
  const spanDays = Math.floor(spanMs / 86_400_000) + 1;
  if (spanDays > MAX_WRITING_DAY_RANGE_DAYS) {
    return { error: `range must be at most ${MAX_WRITING_DAY_RANGE_DAYS} days.` };
  }
  return { from, to };
}

export function parseWritingDayPut(
  body: unknown
): WritingDayTotals | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected a writing day object." };
  }
  const src = body as Record<string, unknown>;
  const date = parseWritingDayDate(src.date);
  if (typeof date !== "string") return date;
  if (!Number.isInteger(src.words) || (src.words as number) < 0 || (src.words as number) > MAX_HEARTBEAT_WORDS) {
    return { error: "words must be a non-negative integer." };
  }
  if (
    !Number.isInteger(src.activeMs) ||
    (src.activeMs as number) < 0 ||
    (src.activeMs as number) > MAX_HEARTBEAT_MS
  ) {
    return { error: "activeMs must be a non-negative integer." };
  }
  return { date, words: src.words as number, activeMs: src.activeMs as number };
}

export class WritingDayAccumulator {
  date: string;
  syncedWords = 0;
  syncedActiveMs = 0;
  pendingWords = 0;
  pendingActiveMs = 0;
  lastKeystrokeAt: number | null = null;

  constructor(
    private pauseMs = PAUSE_MS,
    now = Date.now()
  ) {
    this.date = writingDayKey(new Date(now));
  }

  snapshot(): WritingDaySnapshot {
    return {
      date: this.date,
      words: this.syncedWords + this.pendingWords,
      activeMs: this.syncedActiveMs + this.pendingActiveMs,
      pendingWords: this.pendingWords,
      pendingActiveMs: this.pendingActiveMs,
    };
  }

  takePending(): WritingDayTotals | null {
    if (this.pendingWords === 0 && this.pendingActiveMs === 0) return null;
    return { date: this.date, words: this.pendingWords, activeMs: this.pendingActiveMs };
  }

  /** Returns leftover pending from the previous day so the caller can flush it. */
  shiftDate(now: number): WritingDayTotals | null {
    const date = writingDayKey(new Date(now));
    if (date === this.date) return null;
    const leftover = this.takePending();
    this.date = date;
    this.syncedWords = 0;
    this.syncedActiveMs = 0;
    this.pendingWords = 0;
    this.pendingActiveMs = 0;
    this.lastKeystrokeAt = null;
    return leftover;
  }

  noteStroke(now: number): WritingDayTotals | null {
    const leftover = this.shiftDate(now);
    this.pendingActiveMs += activeMsForStroke(this.lastKeystrokeAt, now, this.pauseMs);
    this.lastKeystrokeAt = now;
    return leftover;
  }

  noteWords(delta: number, now: number): WritingDayTotals | null {
    if (delta <= 0) return this.shiftDate(now);
    const leftover = this.shiftDate(now);
    this.pendingWords += delta;
    this.pendingActiveMs += activeMsForStroke(this.lastKeystrokeAt, now, this.pauseMs);
    this.lastKeystrokeAt = now;
    return leftover;
  }

  restore(row: {
    date: string;
    words: number;
    activeMs: number;
    pendingWords?: number;
    pendingActiveMs?: number;
    lastKeystrokeAt?: number | null;
  }): void {
    this.date = row.date;
    this.syncedWords = row.words;
    this.syncedActiveMs = row.activeMs;
    this.pendingWords = row.pendingWords ?? 0;
    this.pendingActiveMs = row.pendingActiveMs ?? 0;
    this.lastKeystrokeAt = row.lastKeystrokeAt ?? null;
  }

  applyServer(day: WritingDayTotals): void {
    if (day.date !== this.date) return;
    this.syncedWords = day.words;
    this.syncedActiveMs = day.activeMs;
  }

  ackFlush(flushed: WritingDayTotals, server?: Pick<WritingDayTotals, "words" | "activeMs">): void {
    if (flushed.date !== this.date) return;
    this.pendingWords = Math.max(0, this.pendingWords - flushed.words);
    this.pendingActiveMs = Math.max(0, this.pendingActiveMs - flushed.activeMs);
    if (server) {
      this.syncedWords = server.words;
      this.syncedActiveMs = server.activeMs;
    } else {
      this.syncedWords += flushed.words;
      this.syncedActiveMs += flushed.activeMs;
    }
  }

  reset(now = Date.now()): void {
    this.date = writingDayKey(new Date(now));
    this.syncedWords = 0;
    this.syncedActiveMs = 0;
    this.pendingWords = 0;
    this.pendingActiveMs = 0;
    this.lastKeystrokeAt = null;
  }
}
