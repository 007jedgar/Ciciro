"use client";

import { useSyncExternalStore } from "react";

/** Focus mode belongs to this browser only, so it lives in localStorage, not synced settings. */
export const FOCUS_MODE_STORAGE_KEY = "ciciro-focus-mode";

let focusMode: boolean | null = null;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return localStorage.getItem(FOCUS_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function getFocusMode(): boolean {
  if (focusMode === null) focusMode = readStored();
  return focusMode;
}

export function setFocusMode(on: boolean) {
  if (getFocusMode() === on) return;
  focusMode = on;
  try {
    localStorage.setItem(FOCUS_MODE_STORAGE_KEY, on ? "true" : "false");
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFocusMode(): boolean {
  return useSyncExternalStore(subscribe, getFocusMode, () => false);
}
