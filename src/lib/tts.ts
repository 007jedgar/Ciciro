/** Sentence splitting and a small playback controller for read-aloud (text-to-speech). */

export type SentenceRange = { start: number; end: number };

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "mt",
]);
const TERMINATORS = new Set([".", "!", "?", "…"]);
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "»"]);

function endsWithAbbreviation(text: string, dotIndex: number): boolean {
  let i = dotIndex - 1;
  while (i >= 0 && /[A-Za-z.]/.test(text[i])) i--;
  const word = text.slice(i + 1, dotIndex).toLowerCase();
  return ABBREVIATIONS.has(word);
}

/** Split prose into trimmed sentence ranges; offsets index into `text`. */
export function splitSentences(text: string): SentenceRange[] {
  const out: SentenceRange[] = [];
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

export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const DEFAULT_RATE = 1;
export const RATE_STEPS = [0.75, 1, 1.25, 1.5, 2] as const;

export function clampRate(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, n));
}

export type ReaderState = "idle" | "playing" | "paused";

export type SynthLike<U extends UtteranceLike = UtteranceLike> = {
  speak(utterance: U): void;
  cancel(): void;
  pause(): void;
  resume(): void;
};

export type UtteranceLike = {
  text: string;
  rate: number;
  voice: unknown;
  // Browser event types differ per engine; only `error` is read.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onend: ((event: any) => void) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((event: any) => void) | null;
};

export type ReaderListener = (state: ReaderState, index: number) => void;

/**
 * Reads segments one utterance at a time. Sentence-sized utterances avoid the
 * browser cut-off on long text and give a natural hook for highlighting.
 */
export class SpeechReader<U extends UtteranceLike = UtteranceLike> {
  private segments: string[] = [];
  private index = 0;
  private state: ReaderState = "idle";
  private token = 0;
  private rate = DEFAULT_RATE;
  private voice: unknown = null;

  constructor(
    private synth: SynthLike<U>,
    private makeUtterance: (text: string) => U,
    private listener: ReaderListener
  ) {}

  get current(): { state: ReaderState; index: number } {
    return { state: this.state, index: this.index };
  }

  start(segments: string[], options: { rate?: number; voice?: unknown } = {}) {
    this.cancelSpeech();
    this.segments = segments.filter((s) => s.trim().length > 0);
    this.rate = clampRate(options.rate ?? this.rate);
    this.voice = options.voice ?? null;
    this.index = 0;
    if (this.segments.length === 0) {
      this.setState("idle");
      return;
    }
    this.setState("playing");
    this.speakCurrent();
  }

  pause() {
    if (this.state !== "playing") return;
    this.synth.pause();
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.setState("playing");
    // Some engines drop a paused utterance; restarting the sentence is safe.
    this.cancelSpeech();
    this.speakCurrent();
  }

  stop() {
    this.cancelSpeech();
    this.index = 0;
    this.setState("idle");
  }

  setRate(rate: number) {
    this.rate = clampRate(rate);
    this.restartIfPlaying();
  }

  setVoice(voice: unknown) {
    this.voice = voice;
    this.restartIfPlaying();
  }

  private restartIfPlaying() {
    if (this.state !== "playing") return;
    this.cancelSpeech();
    this.speakCurrent();
  }

  private cancelSpeech() {
    this.token++;
    this.synth.cancel();
  }

  private speakCurrent() {
    const token = ++this.token;
    const utterance = this.makeUtterance(this.segments[this.index]);
    utterance.rate = this.rate;
    utterance.voice = this.voice;
    utterance.onend = () => {
      if (token !== this.token || this.state !== "playing") return;
      if (this.index + 1 >= this.segments.length) {
        this.index = 0;
        this.setState("idle");
        return;
      }
      this.index++;
      this.listener(this.state, this.index);
      this.speakCurrent();
    };
    utterance.onerror = (event) => {
      if (token !== this.token) return;
      // Cancelling triggers "canceled"/"interrupted"; those are ours, not failures.
      if (event?.error === "canceled" || event?.error === "interrupted") return;
      this.index = 0;
      this.setState("idle");
    };
    this.listener(this.state, this.index);
    this.synth.speak(utterance);
  }

  private setState(state: ReaderState) {
    this.state = state;
    this.listener(state, this.index);
  }
}
