import { useSyncExternalStore } from "react";

/** Share of the editor's height kept clear above and below the text in typewriter mode. */
export const TYPEWRITER_INSET_RATIO = 0.4;

/** Typewriter padding never squeezes the visible writing band below this height. */
export const TYPEWRITER_MIN_TEXT_HEIGHT = 160;

/** Focus mode belongs to this device only, so it lives in local prefs, not synced settings. */
const FOCUS_KEY = "focus-mode";

let focusMode: boolean | null = null;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    return getPrefs().getString(FOCUS_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStored(on: boolean) {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(FOCUS_KEY, on ? "true" : "false");
  } catch {
    /* web / tests / missing native module */
  }
}

export function getFocusMode(): boolean {
  if (focusMode === null) focusMode = readStored();
  return focusMode;
}

export function setFocusMode(on: boolean) {
  if (getFocusMode() === on) return;
  focusMode = on;
  writeStored(on);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFocusMode(): boolean {
  return useSyncExternalStore(subscribe, getFocusMode, getFocusMode);
}

/** Chrome (header, tab bar, meters) hides only while writing on the editor tab. */
export function focusChromeHidden(focusMode: boolean, onEditor: boolean): boolean {
  return focusMode && onEditor;
}

/**
 * Typewriter mode pads the page so the line being written rests in a band near
 * the middle of the editor instead of sinking to the bottom edge. The band
 * never shrinks below `TYPEWRITER_MIN_TEXT_HEIGHT`, so a short editor (for
 * example with the keyboard open) still shows the line being written.
 */
export function typewriterInsets(
  typewriterMode: boolean,
  editorHeight: number
): { top: number; bottom: number } {
  if (!typewriterMode || !Number.isFinite(editorHeight) || editorHeight <= 0) {
    return { top: 0, bottom: 0 };
  }
  const room = Math.max(0, Math.floor((editorHeight - TYPEWRITER_MIN_TEXT_HEIGHT) / 2));
  const inset = Math.min(Math.round(editorHeight * TYPEWRITER_INSET_RATIO), room);
  return { top: inset, bottom: inset };
}
