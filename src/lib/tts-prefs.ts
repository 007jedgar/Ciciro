"use client";

import { useSyncExternalStore } from "react";
import { clampRate, DEFAULT_RATE } from "@/lib/tts";

/** Voices differ per device, so read-aloud preferences stay in this browser. */
export const TTS_STORAGE_KEY = "ciciro-read-aloud";

export type TtsPrefs = { rate: number; voiceURI: string | null };

const DEFAULTS: TtsPrefs = { rate: DEFAULT_RATE, voiceURI: null };

let prefs: TtsPrefs | null = null;
const listeners = new Set<() => void>();

function readStored(): TtsPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(TTS_STORAGE_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      return {
        rate: clampRate(raw.rate),
        voiceURI: typeof raw.voiceURI === "string" ? raw.voiceURI : null,
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

export function getTtsPrefs(): TtsPrefs {
  if (prefs === null) prefs = readStored();
  return prefs;
}

export function setTtsPrefs(patch: Partial<TtsPrefs>) {
  const next = { ...getTtsPrefs(), ...patch };
  next.rate = clampRate(next.rate);
  prefs = next;
  try {
    localStorage.setItem(TTS_STORAGE_KEY, JSON.stringify(next));
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

export function useTtsPrefs(): TtsPrefs {
  return useSyncExternalStore(subscribe, getTtsPrefs, () => DEFAULTS);
}
