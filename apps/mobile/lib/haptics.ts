import * as Haptics from "expo-haptics";
import { useSyncExternalStore } from "react";

/**
 * Every haptic in the app goes through here so the Settings switch silences all
 * of them. Haptics belong to this device (an iPad has no Taptic Engine, and
 * some people only want them on one phone), so the switch lives in local prefs
 * like focus mode, not in the synced settings.
 */
const HAPTICS_KEY = "haptics-enabled";

/** The writing tick never fires more often than this, whatever the stream does. */
export const WRITING_TICK_MIN_INTERVAL_MS = 450;

let enabled: boolean | null = null;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    return getPrefs().getString(HAPTICS_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStored(on: boolean) {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(HAPTICS_KEY, on ? "true" : "false");
  } catch {
    /* web / tests / missing native module */
  }
}

export function getHapticsEnabled(): boolean {
  if (enabled === null) enabled = readStored();
  return enabled;
}

export function setHapticsEnabled(on: boolean) {
  if (getHapticsEnabled() === on) return;
  enabled = on;
  writeStored(on);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHapticsEnabled(): boolean {
  return useSyncExternalStore(subscribe, getHapticsEnabled, getHapticsEnabled);
}

function fire(run: () => Promise<void>) {
  if (!getHapticsEnabled()) return;
  try {
    run().catch(() => {});
  } catch {
    /* no Taptic Engine / missing native module */
  }
}

/** A light tap for pressing a button, pill, tile or row. */
export function tap() {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function impact(style: "light" | "medium" | "heavy" = "medium") {
  const styles = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  };
  fire(() => Haptics.impactAsync(styles[style]));
}

/** The detent tick for moving through a set of choices. */
export function select() {
  fire(() => Haptics.selectionAsync());
}

export function success() {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function warning() {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

export function error() {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

let lastWritingTickAt = -Infinity;

/** One soft tick while Ciciro's prose lands, rate limited however fast it streams. */
export function writingTick(now: number = Date.now()) {
  if (now - lastWritingTickAt < WRITING_TICK_MIN_INTERVAL_MS) return;
  if (!getHapticsEnabled()) return;
  lastWritingTickAt = now;
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
}

/** Test seam: forget the last tick so a case starts from a clean slate. */
export function resetWritingTick() {
  lastWritingTickAt = -Infinity;
}

const SENTENCE_END = /[.!?…]["'”’)\]]*(\s|$)/;

/**
 * Paces ticks to the prose: feed it each streamed chunk and it ticks once per
 * finished sentence (and at most once per `WRITING_TICK_MIN_INTERVAL_MS`), not
 * per token.
 */
export function createWritingTicker(now: () => number = Date.now) {
  let pending = "";
  return {
    feed(chunk: string) {
      pending += chunk;
      if (!SENTENCE_END.test(pending)) return;
      pending = "";
      writingTick(now());
    },
    /** A write that lands whole (a tracked edit, a new chapter) ticks once. */
    landed() {
      pending = "";
      writingTick(now());
    },
  };
}

/**
 * Wraps a press handler so the press taps: `onPress={withTap(onPress)}`. The
 * handler runs first, so a switch that turns haptics off does not tap on its way out.
 */
export function withTap<Args extends unknown[]>(handler: ((...args: Args) => void) | undefined) {
  return (...args: Args) => {
    handler?.(...args);
    tap();
  };
}
