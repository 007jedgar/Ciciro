import { useSyncExternalStore } from "react";
import { api } from "./api";
import { consentModeFor, freshGeo, type ConsentMode, type GeoSignal } from "./consent-region";

/**
 * The device's coarse location for the consent decision: asked of our own
 * server (Cloudflare resolves the country, and the state in the US, from the
 * request's IP; nothing finer, nothing stored server-side), cached on the
 * device, refreshed at launch and when the app returns to the foreground.
 * When it cannot be learned, the answer is "unknown", which means the prompt
 * shows. The device's language region is deliberately not a fallback: it says
 * nothing about the state, which is the one thing it would have to decide.
 */

const CACHE_KEY = "consent-region";
/** A foreground re-check happens at most this often; launch always checks. */
export const REGION_REFRESH_MS = 6 * 60 * 60 * 1000;
/** The prompt waits this long for a first lookup before treating the location as unknown. */
export const REGION_PATIENCE_MS = 5000;

type Stored = { geo: GeoSignal; fetchedAt: number };

export type RegionState = {
  /** The last known location, null while unknown (never learned, or too old to trust). */
  geo: GeoSignal | null;
  /** False until the first lookup this launch has come back or failed, so the prompt can wait instead of flashing. */
  settled: boolean;
};

export type RegionClient = { fetchGeo(): Promise<GeoSignal> };

const defaultClient: RegionClient = { fetchGeo: () => api<GeoSignal>("/api/app/consent-region") };

function cleanCode(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function readStored(): Stored | null {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const raw = getPrefs().getString(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.fetchedAt !== "number") return null;
    const geo = parsed.geo;
    if (!geo || typeof geo !== "object") return null;
    return { geo: { country: cleanCode(geo.country), region: cleanCode(geo.region) }, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeStored(stored: Stored): void {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(CACHE_KEY, JSON.stringify(stored));
  } catch {
    /* web / tests / missing native module */
  }
}

let stored: Stored | null | undefined;
let settled = false;
let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;
let snapshot: RegionState | null = null;
const listeners = new Set<() => void>();

function current(now: number): RegionState {
  if (stored === undefined) stored = readStored();
  const geo = freshGeo(stored, now);
  if (snapshot && snapshot.geo === geo && snapshot.settled === settled) return snapshot;
  snapshot = { geo, settled };
  return snapshot;
}

function emit() {
  snapshot = null;
  for (const listener of listeners) listener();
}

/** The current location state, for non-React callers. */
export function getRegionState(now: number = Date.now()): RegionState {
  return current(now);
}

/** The consent mode right now: opt-in unless we know the person is in the opt-out part of the US. */
export function getConsentMode(now: number = Date.now()): ConsentMode {
  return consentModeFor(current(now).geo);
}

/**
 * Looks the location up (once at a time) and caches it. A failed lookup keeps
 * whatever is cached and still counts as settled, so the app never waits on a
 * dead network; the next foreground tries again.
 */
export function refreshRegion(client: RegionClient = defaultClient, now: () => number = Date.now): Promise<void> {
  if (inFlight) return inFlight;
  lastAttemptAt = now();
  const patience = setTimeout(() => {
    if (settled) return;
    settled = true;
    emit();
  }, REGION_PATIENCE_MS);
  inFlight = (async () => {
    try {
      const reply = await client.fetchGeo();
      const geo: GeoSignal = { country: cleanCode(reply?.country), region: cleanCode(reply?.region) };
      stored = { geo, fetchedAt: now() };
      writeStored(stored);
    } catch {
      /* keep the cache */
    } finally {
      clearTimeout(patience);
      settled = true;
      inFlight = null;
      emit();
    }
  })();
  return inFlight;
}

/** Re-checks on a foreground return when the last attempt is old enough. */
export function refreshRegionIfStale(client?: RegionClient, now: () => number = Date.now): Promise<void> {
  if (inFlight) return inFlight;
  if (settled && now() - lastAttemptAt < REGION_REFRESH_MS) return Promise.resolve();
  return refreshRegion(client, now);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget everything held in memory (the disk cache is the test's to clear). */
export function resetRegionStateForTests(): void {
  stored = undefined;
  settled = false;
  lastAttemptAt = 0;
  inFlight = null;
  snapshot = null;
  listeners.clear();
}

/** The location state, reactive to lookups finishing. */
export function useRegionState(): RegionState {
  return useSyncExternalStore(subscribe, () => current(Date.now()), () => current(Date.now()));
}

/** The consent mode, reactive. `known` is whether any location is held; `settled` is false until this launch's first lookup finishes (or `REGION_PATIENCE_MS` passes). */
export function useConsentMode(): { mode: ConsentMode; settled: boolean; known: boolean } {
  const { geo, settled: done } = useRegionState();
  return { mode: consentModeFor(geo), settled: done, known: geo !== null };
}
