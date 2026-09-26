import { useSyncExternalStore } from "react";

/** Read-aloud (text-to-speech) helpers: sentence splitting, prefs and a sentence-by-sentence reader. */

export type Sentence = { line: number; start: number; end: number; text: string };

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "mt",
]);
const TERMINATORS = new Set([".", "!", "?", "…"]);
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "»"]);

function endsWithAbbreviation(text: string, dotIndex: number): boolean {
  let i = dotIndex - 1;
  while (i >= 0 && /[A-Za-z.]/.test(text[i])) i--;
  return ABBREVIATIONS.has(text.slice(i + 1, dotIndex).toLowerCase());
}

/** Trimmed sentence ranges of one line of prose; offsets index into `text`. */
export function splitSentences(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  const push = (from: number, to: number) => {
    let s = from;
    let e = to;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push({ start: s, end: e });
  };
  let i = 0;
  while (i < text.length) {
    if (!TERMINATORS.has(text[i])) {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < text.length && (TERMINATORS.has(text[end]) || CLOSERS.has(text[end]))) end++;
    const boundary = end >= text.length || /\s/.test(text[end]);
    if (boundary && !(text[i] === "." && end === i + 1 && endsWithAbbreviation(text, i))) {
      push(start, end);
      start = end;
    }
    i = end;
  }
  push(start, text.length);
  return out;
}

/**
 * Sentences of a chapter's plain text (paragraphs joined by "\n", the same
 * offsets the editor reports). A selection narrows it to that range.
 */
export function readAloudSentences(
  plain: string,
  selection?: { start: number; end: number } | null
): Sentence[] {
  const lo = selection ? Math.max(0, Math.min(selection.start, selection.end)) : 0;
  const hi = selection ? Math.min(plain.length, Math.max(selection.start, selection.end)) : plain.length;
  const out: Sentence[] = [];
  let offset = 0;
  plain.split("\n").forEach((line, index) => {
    const lineStart = offset;
    offset += line.length + 1;
    if (lineStart + line.length <= lo || lineStart >= hi) return;
    for (const range of splitSentences(line)) {
      const start = Math.max(range.start, lo - lineStart);
      const end = Math.min(range.end, hi - lineStart);
      if (end <= start) continue;
      const text = line.slice(start, end).trim();
      if (text) out.push({ line: index, start, end, text });
    }
  });
  return out;
}

export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const DEFAULT_RATE = 1;
export const RATE_STEPS = [0.75, 1, 1.25, 1.5, 2] as const;

export function clampRate(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, n));
}

/** Selection to read, published by the editor when the writer selects text. */
export type ReadAloudSelection = { chapterId: string; start: number; end: number };
let selection: ReadAloudSelection | null = null;
export function setReadAloudSelection(next: ReadAloudSelection | null) {
  selection = next && next.start !== next.end ? next : null;
}
export function getReadAloudSelection(): ReadAloudSelection | null {
  return selection;
}

/** Read-aloud speed and voice belong to this device, so they live in local prefs. */
const PREFS_KEY = "read-aloud";
export type ReadAloudPrefs = { rate: number; voice: string | null };
const DEFAULTS: ReadAloudPrefs = { rate: DEFAULT_RATE, voice: null };
let prefs: ReadAloudPrefs | null = null;
const listeners = new Set<() => void>();

function readStored(): ReadAloudPrefs {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const raw = JSON.parse(getPrefs().getString(PREFS_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      return { rate: clampRate(raw.rate), voice: typeof raw.voice === "string" ? raw.voice : null };
    }
  } catch {
    /* web / tests / missing native module */
  }
  return DEFAULTS;
}

export function getReadAloudPrefs(): ReadAloudPrefs {
  if (prefs === null) prefs = readStored();
  return prefs;
}

export function setReadAloudPrefs(patch: Partial<ReadAloudPrefs>) {
  const next = { ...getReadAloudPrefs(), ...patch };
  next.rate = clampRate(next.rate);
  prefs = next;
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* web / tests / missing native module */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReadAloudPrefs(): ReadAloudPrefs {
  return useSyncExternalStore(subscribe, getReadAloudPrefs, getReadAloudPrefs);
}

export type ReaderState = "idle" | "playing" | "paused";

export type SpeechEngine = {
  speak(
    text: string,
    options: { rate: number; voice?: string; onDone: () => void; onError: () => void }
  ): void;
  stop(): void;
};

/**
 * Reads sentences one utterance at a time. Pause stops the engine and resumes
 * from the start of the current sentence, which works the same on iOS and
 * Android (expo-speech can only pause on iOS).
 */
export class SentenceReader {
  private texts: string[] = [];
  private index = 0;
  private state: ReaderState = "idle";
  private token = 0;
  private rate = DEFAULT_RATE;
  private voice: string | null = null;

  constructor(
    private engine: SpeechEngine,
    private listener: (state: ReaderState, index: number) => void
  ) {}

  get current() {
    return { state: this.state, index: this.index };
  }

  start(texts: string[], options: { rate?: number; voice?: string | null } = {}) {
    this.halt();
    this.texts = texts.filter((t) => t.trim().length > 0);
    this.rate = clampRate(options.rate ?? this.rate);
    this.voice = options.voice ?? null;
    this.index = 0;
    if (this.texts.length === 0) return this.setState("idle");
    this.setState("playing");
    this.speakCurrent();
  }

  pause() {
    if (this.state !== "playing") return;
    this.halt();
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.setState("playing");
    this.speakCurrent();
  }

  stop() {
    this.halt();
    this.index = 0;
    this.setState("idle");
  }

  setRate(rate: number) {
    this.rate = clampRate(rate);
    this.restartIfPlaying();
  }

  setVoice(voice: string | null) {
    this.voice = voice;
    this.restartIfPlaying();
  }

  private restartIfPlaying() {
    if (this.state !== "playing") return;
    this.halt();
    this.speakCurrent();
  }

  private halt() {
    this.token++;
    this.engine.stop();
  }

  private speakCurrent() {
    const token = ++this.token;
    this.listener(this.state, this.index);
    this.engine.speak(this.texts[this.index], {
      rate: this.rate,
      voice: this.voice ?? undefined,
      onDone: () => {
        if (token !== this.token || this.state !== "playing") return;
        if (this.index + 1 >= this.texts.length) {
          this.index = 0;
          this.setState("idle");
          return;
        }
        this.index++;
        this.speakCurrent();
      },
      onError: () => {
        if (token !== this.token) return;
        this.index = 0;
        this.setState("idle");
      },
    });
  }

  private setState(state: ReaderState) {
    this.state = state;
    this.listener(state, this.index);
  }
}

/** The device's speech engine, loaded lazily so tests and web never touch the native module. */
export function expoSpeechEngine(): SpeechEngine {
  const Speech = require("expo-speech") as typeof import("expo-speech");
  return {
    speak(text, { rate, voice, onDone, onError }) {
      Speech.speak(text, { rate, voice, onDone, onError: () => onError() });
    },
    stop() {
      void Speech.stop();
    },
  };
}
