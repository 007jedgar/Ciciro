import { useSyncExternalStore } from "react";

/** Typewriter padding never squeezes the visible writing area below this height. */
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
 * Typewriter mode on mobile pads only the bottom of the page, by half the
 * editor's height, so the last lines can scroll up to the middle of the screen
 * instead of sinking to the bottom edge. There is no top inset, so no part of
 * the page is permanently blank above the text.
 *
 * Limitation: the native EnrichedTextInput cannot report the caret's position
 * or be scrolled programmatically, so mobile cannot re-center the caret line on
 * every keystroke the way the web editor does. The native view keeps the caret
 * visible, and this padding lets the writer scroll the working line to the middle.
 */
export function typewriterBottomInset(typewriterMode: boolean, editorHeight: number): number {
  if (!typewriterMode || !Number.isFinite(editorHeight) || editorHeight <= 0) return 0;
  const room = Math.max(0, Math.floor(editorHeight - TYPEWRITER_MIN_TEXT_HEIGHT));
  return Math.min(Math.round(editorHeight / 2), room);
}
