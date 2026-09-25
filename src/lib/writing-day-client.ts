"use client";

import {
  HEARTBEAT_MS,
  holdWritingDaySnapshot,
  WritingDayAccumulator,
  type WritingDayTotals,
} from "@/lib/writing-day";
import {
  SITTING_IDLE_MS,
  WritingSessionTracker,
  type WritingSessionTotals,
} from "@/lib/writing-session";

type ServerDay = WritingDayTotals & { updatedAt?: string };

let acc = new WritingDayAccumulator();
const sittings = new WritingSessionTracker();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let cachedSnapshot: WritingDayTotals | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: WritingDayTotals | null = null;
let hydrating: Promise<void> | null = null;
let visibilityBound = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function scheduleFlush(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flushWritingDay();
  }, HEARTBEAT_MS);
}

async function sendHeartbeat(delta: WritingDayTotals): Promise<ServerDay | null> {
  const res = await fetch("/api/writing/day", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(delta),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { day?: ServerDay };
  return body.day ?? null;
}

async function sendSitting(session: WritingSessionTotals): Promise<void> {
  try {
    await fetch("/api/writing/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session),
    });
  } catch {
    /* sitting is already closed locally */
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

async function fetchDay(date: string): Promise<ServerDay | null> {
  const res = await fetch(`/api/writing/day?date=${encodeURIComponent(date)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { day?: ServerDay };
  return body.day ?? null;
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
  if (inFlight) return;
  const pending = acc.takePending();
  if (!pending) return;
  await flushOne(pending);
  emit();
  if (acc.takePending()) scheduleFlush();
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushWritingDay();
  });
  window.addEventListener("pagehide", () => {
    void flushWritingDay();
  });
}

async function flushLeftover(leftover: WritingDayTotals | null): Promise<void> {
  if (!leftover) return;
  try {
    await sendHeartbeat(leftover);
  } catch {
    /* yesterday's pending will retry on the next visit if hydrate restores it */
  }
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
  bindVisibility();
  const leftover = acc.noteStroke(now);
  recordSitting(sittings.noteStroke(now));
  emit();
  void flushLeftover(leftover);
  scheduleFlush();
}

export function noteWritingWords(delta: number, now = Date.now()): void {
  bindVisibility();
  const leftover = acc.noteWords(delta, now);
  recordSitting(sittings.noteWords(delta, now));
  emit();
  void flushLeftover(leftover);
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

export async function hydrateWritingDay(): Promise<void> {
  bindVisibility();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    const date = acc.snapshot().date;
    try {
      const day = await fetchDay(date);
      if (day) {
        acc.applyServer(day);
        emit();
      }
    } catch {
      /* stay on local pending */
    } finally {
      hydrating = null;
    }
  })();
  return hydrating;
}

export function resetWritingDayClient(now = Date.now()): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const closed = sittings.close(now);
  if (closed) void sendSitting(closed);
  acc.reset(now);
  emit();
}

export async function fetchWritingDays(
  from: string,
  to: string
): Promise<WritingDayTotals[] | null> {
  const res = await fetch(
    `/api/writing/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: "include" }
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { days?: WritingDayTotals[] };
  return Array.isArray(body.days)
    ? body.days.map((day) => ({
        date: day.date,
        words: day.words,
        activeMs: day.activeMs,
      }))
    : null;
}

export async function fetchWritingSessions(limit = 50): Promise<WritingSessionTotals[] | null> {
  const res = await fetch(`/api/writing/sessions?limit=${encodeURIComponent(String(limit))}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { sessions?: WritingSessionTotals[] };
  return Array.isArray(body.sessions) ? body.sessions : null;
}

/** Test seam: swap the accumulator without exposing it to the UI. */
export function _setWritingDayAccumulatorForTests(next: WritingDayAccumulator): void {
  acc = next;
  cachedSnapshot = null;
}
