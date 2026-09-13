export const PAUSE_MS = 30_000;
export const HEARTBEAT_MS = 2_000;
export const WRITING_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_HEARTBEAT_WORDS = 100_000;
export const MAX_HEARTBEAT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DAILY_WORD_GOAL = 250;
export const DAILY_WORD_GOAL_MIN = 50;
export const DAILY_WORD_GOAL_MAX = 10_000;

export type WritingDayTotals = {
  date: string;
  words: number;
  activeMs: number;
};

export type WritingDaySnapshot = WritingDayTotals & {
  pendingWords: number;
  pendingActiveMs: number;
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
