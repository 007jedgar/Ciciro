import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { AppState, type NativeEventSubscription } from "react-native";
import { ciciro } from "./api/resources";
import { getWritingDay, upsertWritingDay } from "./db";
import { useSession } from "./session";
import {
  HEARTBEAT_MS,
  holdWritingDaySnapshot,
  WritingDayAccumulator,
  writingDayKey,
  type WritingDayTotals,
} from "./writing-day";
import {
  SITTING_IDLE_MS,
  WritingSessionTracker,
  type WritingSessionTotals,
} from "./writing-session";

const acc = new WritingDayAccumulator();
const sittings = new WritingSessionTracker();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let cachedSnapshot: WritingDayTotals | null = null;
let userId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: WritingDayTotals | null = null;
let appSub: NativeEventSubscription | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function snapshotRow(): Parameters<typeof upsertWritingDay>[0] | null {
  if (!userId) return null;
  const snap = acc.snapshot();
  return {
    userId,
    date: snap.date,
    words: acc.syncedWords,
    activeMs: acc.syncedActiveMs,
    pendingWords: acc.pendingWords,
    pendingActiveMs: acc.pendingActiveMs,
    lastKeystrokeAt: acc.lastKeystrokeAt,
    updatedAt: new Date().toISOString(),
  };
}

async function persistLocal(): Promise<void> {
  const row = snapshotRow();
  if (!row) return;
  try {
    await upsertWritingDay(row);
  } catch {
    /* tests / web replica */
  }
}

function scheduleFlush(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flushWritingDay();
  }, HEARTBEAT_MS);
}

async function sendHeartbeat(delta: WritingDayTotals): Promise<WritingDayTotals | null> {
  const data = await ciciro.writing.day.put(delta);
  return data.day ?? null;
}

async function sendSitting(session: WritingSessionTotals): Promise<void> {
  if (!userId) return;
  try {
    await ciciro.writing.sessions.post(session);
  } catch {
    /* sitting already closed locally */
  }
}

function scheduleSittingIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const closed = sittings.checkIdle(Date.now());
    if (closed) void sendSitting(closed);
  }, SITTING_IDLE_MS + 50);
}

function recordSitting(closed: WritingSessionTotals | null): void {
  if (closed) void sendSitting(closed);
  if (sittings.open) scheduleSittingIdle();
  else if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

async function flushOne(delta: WritingDayTotals): Promise<void> {
  inFlight = delta;
  try {
    const server = await sendHeartbeat(delta);
    if (server) acc.ackFlush(delta, server);
  } catch {
    /* keep pending until the next heartbeat */
  } finally {
    inFlight = null;
  }
}

export async function flushWritingDay(): Promise<void> {
  if (inFlight || !userId) return;
  const pending = acc.takePending();
  if (!pending) return;
  await flushOne(pending);
  await persistLocal();
  emit();
  if (acc.takePending()) scheduleFlush();
}

async function flushLeftover(leftover: WritingDayTotals | null): Promise<void> {
  if (!leftover || !userId) return;
  try {
    await sendHeartbeat(leftover);
  } catch {
    try {
      await upsertWritingDay({
        userId,
        date: leftover.date,
        words: 0,
        activeMs: 0,
        pendingWords: leftover.words,
        pendingActiveMs: leftover.activeMs,
        lastKeystrokeAt: null,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* offline leftover stays in the live accumulator only */
    }
  }
}

async function hydrateFromReplica(id: string): Promise<void> {
  try {
    const today = writingDayKey();
    const row = await getWritingDay(id, today);
    if (row) acc.restore(row);
  } catch {
    /* memory-only */
  }
}

export async function startWritingDay(id: string): Promise<void> {
  userId = id;
  acc.reset();
  await hydrateFromReplica(id);
  try {
    const data = await ciciro.writing.day.get(acc.snapshot().date);
    if (data.day) acc.applyServer(data.day);
  } catch {
    /* stay on replica pending */
  }
  emit();
  if (acc.takePending()) scheduleFlush();
  if (!appSub) {
    appSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") void flushWritingDay();
    });
  }
}

export function stopWritingDay(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const closed = sittings.close();
  if (closed) void sendSitting(closed);
  appSub?.remove();
  appSub = null;
  userId = null;
  acc.reset();
  emit();
}

export function getWritingDaySnapshot(): WritingDayTotals {
  const snap = acc.snapshot();
  cachedSnapshot = holdWritingDaySnapshot(cachedSnapshot, {
    date: snap.date,
    words: snap.words,
    activeMs: snap.activeMs,
  });
  return cachedSnapshot;
}

export function subscribeWritingDay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function noteWritingStroke(now = Date.now()): void {
  const leftover = acc.noteStroke(now);
  recordSitting(sittings.noteStroke(now));
  void persistLocal();
  void flushLeftover(leftover);
  emit();
  scheduleFlush();
}

export function noteWritingWords(delta: number, now = Date.now()): void {
  const leftover = acc.noteWords(delta, now);
  recordSitting(sittings.noteWords(delta, now));
  void persistLocal();
  void flushLeftover(leftover);
  emit();
  scheduleFlush();
}

/** Close the open sitting (sprint end). Returns the closed row if any. */
export function closeWritingSitting(now = Date.now()): WritingSessionTotals | null {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const closed = sittings.close(now);
  if (closed) void sendSitting(closed);
  return closed;
}

/**
 * End a sprint: close any open sitting, or POST a session for the sprint window
 * when no keystrokes opened one yet.
 */
export function closeSprintSitting(
  projectId: string,
  startedAt: number,
  words: number,
  now = Date.now()
): void {
  const closed = closeWritingSitting(now);
  if (closed) return;
  void sendSitting({
    projectId,
    startedAt,
    endedAt: Math.max(now, startedAt),
    words: Math.max(0, Math.floor(words)),
    activeMs: 0,
  });
}

function subscribe(listener: () => void): () => void {
  return subscribeWritingDay(listener);
}

export function useWritingDay(): WritingDayTotals {
  return useSyncExternalStore(subscribe, getWritingDaySnapshot, getWritingDaySnapshot);
}

export function WritingDayProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  useEffect(() => {
    if (!user) {
      stopWritingDay();
      return;
    }
    void startWritingDay(user.id);
    return () => {
      void flushWritingDay();
    };
  }, [user]);
  return children;
}
