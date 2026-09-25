/** Idle longer than this ends a sitting (same idea as “five minutes is a session”). */
export const SITTING_IDLE_MS = 5 * 60_000;
/** Prefer mean sitting length once this many closed sittings exist. */
export const SITTING_AVG_MIN_COUNT = 3;

export type WritingSessionTotals = {
  projectId: string | null;
  startedAt: number;
  endedAt: number;
  words: number;
  activeMs: number;
};

export type OpenWritingSession = {
  projectId: string | null;
  startedAt: number;
  words: number;
  activeMs: number;
  lastAt: number;
};

export function sittingDurationMs(session: Pick<WritingSessionTotals, "startedAt" | "endedAt">): number {
  return Math.max(0, session.endedAt - session.startedAt);
}

export function averageSittingDurationMs(
  sessions: ReadonlyArray<Pick<WritingSessionTotals, "startedAt" | "endedAt">>
): number | null {
  if (sessions.length === 0) return null;
  let sum = 0;
  for (const session of sessions) sum += sittingDurationMs(session);
  return Math.round(sum / sessions.length);
}

/** Local hour of day (0–23) when sittings usually start; null until enough exist. */
export function medianSittingStartHour(
  sessions: ReadonlyArray<Pick<WritingSessionTotals, "startedAt">>,
  minCount = SITTING_AVG_MIN_COUNT
): number | null {
  if (sessions.length < minCount) return null;
  const hours = sessions
    .map((session) => new Date(session.startedAt).getHours())
    .sort((a, b) => a - b);
  const mid = Math.floor(hours.length / 2);
  if (hours.length % 2 === 1) return hours[mid]!;
  return Math.round((hours[mid - 1]! + hours[mid]!) / 2);
}

/**
 * Tracks an open sitting. A gap longer than `idleMs` between strokes closes the
 * previous sitting and starts a new one on the next stroke.
 */
export class WritingSessionTracker {
  open: OpenWritingSession | null = null;

  constructor(private idleMs = SITTING_IDLE_MS) {}

  noteStroke(now: number, projectId: string | null = null): WritingSessionTotals | null {
    return this.touch(now, 0, 0, projectId);
  }

  noteWords(
    delta: number,
    now: number,
    projectId: string | null = null,
    activeMs = 0
  ): WritingSessionTotals | null {
    if (delta <= 0 && activeMs <= 0) return this.checkIdle(now);
    return this.touch(now, Math.max(0, delta), Math.max(0, activeMs), projectId);
  }

  /** Force-close (sprint end, logout). */
  close(now = Date.now()): WritingSessionTotals | null {
    if (!this.open) return null;
    const closed: WritingSessionTotals = {
      projectId: this.open.projectId,
      startedAt: this.open.startedAt,
      endedAt: Math.max(now, this.open.lastAt),
      words: this.open.words,
      activeMs: this.open.activeMs,
    };
    this.open = null;
    return closed;
  }

  checkIdle(now: number): WritingSessionTotals | null {
    if (!this.open) return null;
    if (now - this.open.lastAt < this.idleMs) return null;
    return this.close(this.open.lastAt + this.idleMs);
  }

  private touch(
    now: number,
    words: number,
    activeMs: number,
    projectId: string | null
  ): WritingSessionTotals | null {
    const closed = this.checkIdle(now);
    if (!this.open) {
      this.open = {
        projectId,
        startedAt: now,
        words,
        activeMs,
        lastAt: now,
      };
      return closed;
    }
    if (projectId && !this.open.projectId) this.open.projectId = projectId;
    this.open.words += words;
    this.open.activeMs += activeMs;
    this.open.lastAt = now;
    return closed;
  }
}
