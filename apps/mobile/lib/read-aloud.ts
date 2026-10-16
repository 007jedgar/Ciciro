import { useSyncExternalStore } from "react";
import { naturalVoiceById, type EnginePreference, type NaturalLanguage } from "./natural-voice";

/** Read-aloud (text-to-speech) helpers: sentence splitting, prefs and a sentence-by-sentence reader. */

export type Sentence = { line: number; start: number; end: number; text: string };

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "mt",
]);
// "।" and "॥" end a Hindi sentence the way "." ends an English one.
const TERMINATORS = new Set([".", "!", "?", "…", "।", "॥"]);
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

/**
 * Selection to read, published by the editor when the writer selects text.
 * `text` is what the offsets covered then, so later edits invalidate it.
 */
export type ReadAloudSelection = { chapterId: string; start: number; end: number; text: string };
let selection: ReadAloudSelection | null = null;
export function setReadAloudSelection(next: ReadAloudSelection | null) {
  selection = next && next.start !== next.end && next.text ? next : null;
}
/** The text the writer has highlighted in this chapter right now, or "" when nothing is. */
export function selectedTextFor(chapterId: string): string {
  return selection && selection.chapterId === chapterId ? selection.text : "";
}
/** The saved selection for this chapter, if the offsets still cover the same text in `plain`. */
export function readAloudSelectionFor(chapterId: string, plain: string): { start: number; end: number } | null {
  if (!selection || selection.chapterId !== chapterId) return null;
  const { start, end, text } = selection;
  return plain.slice(start, end) === text ? { start, end } : null;
}

export type VoiceOption = { identifier: string; name: string; language: string; quality?: string };

/**
 * Apple ships sound-effect voices ("Bells", "Trinoids") and old robotic ones
 * alongside the natural voices. None is any use for hearing a chapter back, so
 * they are never offered (a saved one is still kept, see `voiceChoices`).
 */
const NOVELTY_VOICES = new Set(
  [
    "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Deranged", "Fred",
    "Good News", "Hysterical", "Jester", "Junior", "Kathy", "Organ", "Pipe Organ", "Princess",
    "Ralph", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox", "Agnes", "Bruce", "Vicki",
    "Victoria",
  ].map((n) => n.toLowerCase())
);

export function isNoveltyVoice(voice: VoiceOption): boolean {
  // "Fred" and "Fred (Enhanced)" are the same voice.
  const base = voice.name.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
  return NOVELTY_VOICES.has(base) || /\.speech\.synthesis\.voice\./.test(voice.identifier);
}

const QUALITY_RANK: Record<string, number> = { Premium: 0, Enhanced: 1, Default: 2 };

/**
 * Voices to offer: every natural voice, the device language first and the rest
 * grouped by language, best quality first within each language. The saved voice
 * is always kept so it can be seen and changed.
 */
export function voiceChoices<V extends VoiceOption>(voices: V[], locale: string, saved: string | null): V[] {
  const baseLang = (tag: string) => tag.split(/[-_]/)[0].toLowerCase();
  const lang = baseLang(locale);
  const group = (v: V) => (lang && baseLang(v.language) === lang ? "" : baseLang(v.language));
  const quality = (v: V) => QUALITY_RANK[v.quality ?? "Default"] ?? 2;
  return voices
    .filter((v) => !isNoveltyVoice(v) || v.identifier === saved)
    .sort(
      (a, b) =>
        group(a).localeCompare(group(b)) || quality(a) - quality(b) || a.name.localeCompare(b.name)
    );
}

/** Read-aloud speed and voice belong to this device, so they live in local prefs. */
const PREFS_KEY = "read-aloud";
export type ReadAloudPrefs = {
  rate: number;
  /** The system voice, an identifier from the device's own list. */
  voice: string | null;
  /** The writer's choice of engine; null takes the natural voice once its model is downloaded. */
  engine: EnginePreference | null;
  /** The natural (Kokoro) voice picked for each language. */
  naturalVoices: Partial<Record<NaturalLanguage, string>>;
};
const DEFAULTS: ReadAloudPrefs = { rate: DEFAULT_RATE, voice: null, engine: null, naturalVoices: {} };
let prefs: ReadAloudPrefs | null = null;
const listeners = new Set<() => void>();

function readNaturalVoices(raw: unknown): ReadAloudPrefs["naturalVoices"] {
  if (!raw || typeof raw !== "object") return {};
  const out: ReadAloudPrefs["naturalVoices"] = {};
  for (const language of ["en", "es", "hi"] as const) {
    const id = (raw as Record<string, unknown>)[language];
    // A voice that is no longer offered, or filed under the wrong language, is dropped.
    if (typeof id === "string" && naturalVoiceById(id)?.language === language) out[language] = id;
  }
  return out;
}

function readStored(): ReadAloudPrefs {
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    const raw = JSON.parse(getPrefs().getString(PREFS_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      return {
        rate: clampRate(raw.rate),
        voice: typeof raw.voice === "string" ? raw.voice : null,
        engine: raw.engine === "system" || raw.engine === "natural" ? raw.engine : null,
        naturalVoices: readNaturalVoices(raw.naturalVoices),
      };
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
  next.naturalVoices = readNaturalVoices(next.naturalVoices);
  prefs = next;
  try {
    const { getPrefs } = require("./prefs") as typeof import("./prefs");
    getPrefs().set(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* web / tests / missing native module */
  }
  for (const listener of listeners) listener();
}

/** Forgets what was loaded, so the next read comes from storage (tests). */
export function resetReadAloudPrefsForTests() {
  prefs = null;
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

/** Why an engine gave up partway: it errored, or it could not make speech as fast as it plays. */
export type SpeechError = { reason: "failed" | "too-slow"; index: number };

/**
 * A whole read handed to an engine that works ahead of the sentence being
 * heard (synthesising the next one while this one plays, chaining them with no
 * gap). It reports each sentence as it becomes audible and what to do when it
 * gives up; the reader never sees the engine's queue.
 */
export type SpeechRun = {
  texts: string[];
  /** Sentence to begin at. */
  from: number;
  rate: number;
  voice?: string;
  /** Sentence `index` is now being heard. */
  onSentence(index: number): void;
  /** The engine is preparing audio and nothing is playing yet. */
  onBuffering?(buffering: boolean): void;
  onDone(): void;
  onError(error: SpeechError): void;
};

export type SpeechEngine = {
  speak(
    text: string,
    options: { rate: number; voice?: string; onDone: () => void; onError: () => void }
  ): void;
  stop(): void;
  /** Engines that can read ahead take the whole run instead of one sentence at a time. */
  playRun?(run: SpeechRun): void;
};

export type ReaderOptions = {
  /** Where to carry on from when the engine fails or cannot keep up. */
  fallback?: () => SpeechEngine;
  /** The engine failed or fell behind and `fallback` took over at `index`. */
  onFallback?: (info: SpeechError) => void;
  onBuffering?: (buffering: boolean) => void;
};

/**
 * Reads sentences one utterance at a time. Pause stops the engine and resumes
 * from the start of the current sentence, which works the same on iOS and
 * Android (expo-speech can only pause on iOS). An engine with `playRun` is
 * handed the rest of the read instead, and `fallback` takes over from the
 * sentence it stopped at if it gives up.
 */
export class SentenceReader {
  private texts: string[] = [];
  private index = 0;
  private state: ReaderState = "idle";
  private token = 0;
  private rate = DEFAULT_RATE;
  private voice: string | null = null;
  private fallbackVoice: string | null = null;
  private engine: SpeechEngine;
  private onFallingBack = false;

  constructor(
    private primary: SpeechEngine,
    private listener: (state: ReaderState, index: number) => void,
    private options: ReaderOptions = {}
  ) {
    this.engine = primary;
  }

  get current() {
    return { state: this.state, index: this.index };
  }

  /** True once the fallback engine has taken over the current read. */
  get usingFallback() {
    return this.onFallingBack;
  }

  start(
    texts: string[],
    options: {
      rate?: number;
      voice?: string | null;
      fallbackVoice?: string | null;
      /** Reads this one with another engine than the reader's own (the natural voice); the fallback is unchanged. */
      engine?: SpeechEngine;
    } = {}
  ) {
    this.halt();
    this.engine = options.engine ?? this.primary;
    this.onFallingBack = false;
    this.texts = texts.filter((t) => t.trim().length > 0);
    this.rate = clampRate(options.rate ?? this.rate);
    this.voice = options.voice ?? null;
    this.fallbackVoice = options.fallbackVoice ?? null;
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
    this.options.onBuffering?.(false);
  }

  private speakCurrent() {
    const token = ++this.token;
    this.listener(this.state, this.index);
    const voice = (this.onFallingBack ? this.fallbackVoice : this.voice) ?? undefined;
    if (this.engine.playRun) {
      this.engine.playRun({
        texts: this.texts,
        from: this.index,
        rate: this.rate,
        voice,
        onSentence: (index) => {
          if (token !== this.token || this.state !== "playing") return;
          this.index = index;
          this.listener(this.state, index);
        },
        onBuffering: (buffering) => {
          if (token === this.token) this.options.onBuffering?.(buffering);
        },
        onDone: () => {
          if (token !== this.token || this.state !== "playing") return;
          this.index = 0;
          this.setState("idle");
        },
        onError: (error) => {
          if (token !== this.token || this.state !== "playing") return;
          this.handleRunError(error);
        },
      });
      return;
    }
    this.engine.speak(this.texts[this.index], {
      rate: this.rate,
      voice,
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

  /** A read-ahead engine gave up: carry on from where it stopped on the fallback, or end the read. */
  private handleRunError(error: SpeechError) {
    const fallback = this.options.fallback;
    if (!fallback || this.onFallingBack) {
      this.index = 0;
      this.setState("idle");
      return;
    }
    this.halt();
    this.engine = fallback();
    this.onFallingBack = true;
    this.index = Math.min(Math.max(error.index, 0), this.texts.length - 1);
    this.options.onFallback?.(error);
    this.speakCurrent();
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

/** Where in the viewport the sentence being read is kept, as a fraction of its height. */
export const READ_ALOUD_FOCUS = 0.4;

/**
 * Y of the rendered line a character offset falls on, from a paragraph's laid-out
 * lines. The lines' text runs on from one to the next, so an offset lands on the
 * line whose running length first passes it; past the end it is the last line.
 */
export function lineYForOffset(lines: readonly { text: string; y: number }[], offset: number): number {
  let seen = 0;
  for (const line of lines) {
    seen += line.text.length;
    if (offset < seen) return line.y;
  }
  return lines.length > 0 ? lines[lines.length - 1].y : 0;
}

/**
 * The scroll offset that puts a sentence at 40% of the viewport height, so the
 * text being read sits a little above centre with the next lines coming up
 * below it. Never scrolls above the top.
 */
export function readAloudScrollTarget(opts: {
  /** Y of the text block inside the scroll content. */
  bodyY: number;
  /** Y of the sentence's paragraph inside that block. */
  paragraphY: number;
  /** Y of the sentence's first line inside the paragraph. */
  lineY: number;
  viewportHeight: number;
}): number {
  const top = opts.bodyY + opts.paragraphY + opts.lineY;
  return Math.max(0, Math.round(top - opts.viewportHeight * READ_ALOUD_FOCUS));
}
