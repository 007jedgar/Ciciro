"use client";

import { useSyncExternalStore } from "react";

/** Matches the 700px breakpoint in globals.css where the workspace gives way to .open-in-app. */
export const PHONE_WIDTH_QUERY = "(max-width: 699px)";

function subscribe(listener: () => void) {
  const query = window.matchMedia(PHONE_WIDTH_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function getSnapshot(): boolean {
  return window.matchMedia(PHONE_WIDTH_QUERY).matches;
}

/** Null until the browser can answer, so the server and hydration render agree. */
export function usePhoneWidth(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, getSnapshot, () => null);
}
