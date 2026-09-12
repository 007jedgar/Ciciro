"use client";

import {
  HEARTBEAT_MS,
  WritingDayAccumulator,
  type WritingDayTotals,
} from "@/lib/writing-day";

type ServerDay = WritingDayTotals & { updatedAt?: string };

let acc = new WritingDayAccumulator();
let listeners = new Set<() => void>();
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify(delta),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { day?: ServerDay };
  return body.day ?? null;
}

async function fetchDay(date: string): Promise<ServerDay | null> {
  const res = await fetch(`/api/writing/day?date=${encodeURIComponent(date)}`);
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
  return { date: snap.date, words: snap.words, activeMs: snap.activeMs };
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
  emit();
  void flushLeftover(leftover);
  scheduleFlush();
}

export function noteWritingWords(delta: number, now = Date.now()): void {
  bindVisibility();
  const leftover = acc.noteWords(delta, now);
  emit();
  void flushLeftover(leftover);
  scheduleFlush();
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
  acc.reset(now);
  emit();
}

/** Test seam: swap the accumulator without exposing it to the UI. */
export function _setWritingDayAccumulatorForTests(next: WritingDayAccumulator): void {
  acc = next;
}
