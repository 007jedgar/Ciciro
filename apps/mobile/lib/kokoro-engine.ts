/**
 * The natural-voice SpeechEngine: reads a chapter with on-device Kokoro.
 *
 * It owns what a one-sentence-at-a-time engine cannot: it synthesises the next
 * sentences while the current one plays (a few ahead, no more, so a Stop wastes
 * little), hands each to a gapless audio queue, answers repeats from the
 * sentence cache, and gives up cleanly (the reader then carries on in the
 * system voice) when the phone cannot make speech as fast as it plays.
 *
 * Everything native sits behind two small interfaces, so the whole pipeline is
 * tested with fakes: `NaturalRuntime` (text in, samples out) and `AudioOutput`
 * (samples queued, played back to back).
 */
import { DEFAULT_NATURAL_VOICE, naturalVoiceById, type NaturalVoice } from "./natural-voice";
import {
  floatToPcm16,
  pcm16ToFloat,
  sentenceKey,
  type CachedSentence,
} from "./sentence-cache";
import type { SpeechEngine, SpeechRun } from "./read-aloud";

export type NaturalAudio = { samples: Float32Array; sampleRate: number };

/** The model that turns a sentence into speech. One call at a time. */
export type NaturalRuntime = {
  /**
   * Reads the model, and what turns this voice's text into sounds, into memory.
   * Safe to call again: it does nothing when that is already loaded.
   */
  load(voice: NaturalVoice): Promise<void>;
  synthesize(text: string, options: { voice: NaturalVoice; speed: number }): Promise<NaturalAudio>;
  /** Frees the model's memory. */
  release(): Promise<void>;
};

export type OutputEvents = {
  /** The sentence with this tag has just become audible. */
  onStarted(tag: number): void;
  /** The sentence with this tag has finished playing. */
  onEnded(tag: number): void;
  onError(message: string): void;
};

/**
 * A queue of sentences played back to back with no gap. Enqueueing while
 * nothing plays starts playback at once; each sentence reports when it starts
 * and when it ends.
 */
export type AudioOutput = {
  open(events: OutputEvents): void;
  enqueue(tag: number, samples: Float32Array, sampleRate: number): void;
  /** Stops playback and drops anything queued. */
  close(): void;
};

export type SentenceStore = {
  get(key: string): Promise<CachedSentence | null>;
  put(key: string, audio: CachedSentence): Promise<void>;
};

export type EngineEvent =
  | { type: "first-audio"; ms: number }
  | { type: "gave-up"; reason: "failed" | "too-slow"; why: "load" | "synthesis" | "underruns" | "rtf" | "first-audio" }
  | {
      type: "run-finished";
      synthesized: number;
      cached: number;
      underruns: number;
      /** Time spent making speech over its length, or null when every sentence came from the cache. */
      rtf: number | null;
      firstAudioMs: number | null;
    };

export type KokoroEngineOptions = {
  /** Sentences synthesised beyond the one being heard. */
  ahead: number;
  /** The synthesis time over the audio time at which the phone can never keep up. */
  slowRtf: number;
  /** A wait for the next sentence longer than this counts as a stall. */
  stallMs: number;
  /** This many stalls in one read and the phone is not keeping up. */
  maxStalls: number;
  /** A first sentence that takes longer than this to start is too slow to wait for. */
  firstAudioLimitMs: number;
  /** Free the model's memory after this long idle. */
  idleReleaseMs: number;
};

export const KOKORO_ENGINE_DEFAULTS: KokoroEngineOptions = {
  ahead: 2,
  slowRtf: 1.1,
  stallMs: 1200,
  maxStalls: 2,
  firstAudioLimitMs: 15_000,
  idleReleaseMs: 45_000,
};

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type KokoroEngine = SpeechEngine & {
  playRun(run: SpeechRun): void;
  /** Stops reading and frees the model now. */
  dispose(): Promise<void>;
};

/** The model could not be read into memory (as opposed to failing on a sentence). */
class ModelLoadFailed extends Error {
  constructor(cause: unknown) {
    super("The natural voice could not be loaded.");
    this.name = "ModelLoadFailed";
    this.cause = cause;
  }
}

export function createKokoroEngine(deps: {
  runtime: NaturalRuntime;
  output: AudioOutput;
  cache: SentenceStore;
  /** Names the model pack in cache keys, so a new pack never plays old audio. */
  modelId: string;
  now?: () => number;
  timers?: Timers;
  report?: (event: EngineEvent) => void;
  options?: Partial<KokoroEngineOptions>;
}): KokoroEngine {
  const { runtime, output, cache, modelId } = deps;
  const options = { ...KOKORO_ENGINE_DEFAULTS, ...deps.options };
  const now = deps.now ?? Date.now;
  const timers: Timers = deps.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const report = deps.report ?? (() => {});

  let runId = 0;
  let idleTimer: unknown = null;
  // The model takes one sentence at a time, and it cannot be cancelled mid-sentence.
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T>(job: () => Promise<T>): Promise<T> => {
    const next = chain.then(job, job);
    chain = next.catch(() => {});
    return next;
  };

  const cancelIdle = () => {
    if (idleTimer !== null) timers.clearTimeout(idleTimer);
    idleTimer = null;
  };
  const scheduleIdleRelease = () => {
    cancelIdle();
    idleTimer = timers.setTimeout(() => {
      idleTimer = null;
      void serialize(() => runtime.release()).catch(() => {});
    }, options.idleReleaseMs);
  };

  function playRun(run: SpeechRun) {
    const id = ++runId;
    const alive = () => id === runId;
    cancelIdle();

    const voice: NaturalVoice =
      naturalVoiceById(run.voice) ?? (naturalVoiceById(DEFAULT_NATURAL_VOICE.en) as NaturalVoice);
    const texts = run.texts;
    const startedAt = now();

    let next = run.from; // next sentence to prepare
    let heard = run.from - 1; // last sentence that became audible
    let lastQueued = run.from - 1;
    let queuedAny = false;
    let finished = false;
    let giveUp: { reason: "failed" | "too-slow"; why: "load" | "synthesis" | "underruns" | "rtf" | "first-audio" } | null = null;
    let waiters: Array<() => void> = [];
    let idleSince: number | null = null; // the queue ran dry and the next sentence is not ready
    let stalls = 0;
    let synthesized = 0;
    let cached = 0;
    let underruns = 0;
    const rtfs: number[] = [];
    let synthMs = 0;
    let audioMs = 0;
    let gotFirstAudio = false;
    let firstAudioMs: number | null = null;

    const wake = () => {
      const w = waiters;
      waiters = [];
      for (const fn of w) fn();
    };
    const waitForProgress = () => new Promise<void>((resolve) => waiters.push(resolve));

    const finish = () => {
      if (finished || !alive()) return;
      finished = true;
      output.close();
      run.onBuffering?.(false);
      report({
        type: "run-finished",
        synthesized,
        cached,
        underruns,
        rtf: audioMs > 0 ? synthMs / audioMs : null,
        firstAudioMs,
      });
      scheduleIdleRelease();
    };

    /** Everything queued has been heard (or nothing was): hand over to whoever carries on. */
    const settle = () => {
      if (!alive() || finished) return;
      if (giveUp) {
        const index = lastQueued + 1;
        const error = giveUp;
        finish();
        if (index >= texts.length) run.onDone();
        else run.onError({ reason: error.reason, index });
        return;
      }
      if (lastQueued >= texts.length - 1) {
        finish();
        run.onDone();
      }
    };

    const decideToGiveUp = (reason: "failed" | "too-slow", why: NonNullable<typeof giveUp>["why"]) => {
      if (giveUp) return;
      giveUp = { reason, why };
      report({ type: "gave-up", reason, why });
      wake();
      // Nothing is playing or queued ahead: hand over now instead of waiting for audio that will not come.
      if (idleSince !== null || !queuedAny) settle();
    };

    output.open({
      onStarted(tag) {
        if (!alive()) return;
        heard = tag;
        idleSince = null;
        if (!gotFirstAudio) {
          gotFirstAudio = true;
          firstAudioMs = now() - startedAt;
          report({ type: "first-audio", ms: firstAudioMs });
        }
        run.onBuffering?.(false);
        run.onSentence(tag);
        wake();
      },
      onEnded(tag) {
        if (!alive()) return;
        wake();
        if (tag >= lastQueued && (giveUp || lastQueued >= texts.length - 1)) {
          settle();
          return;
        }
        // The next sentence is not in the queue yet: playback has caught up with synthesis.
        if (tag >= lastQueued) {
          idleSince = now();
          underruns++;
          run.onBuffering?.(true);
        }
      },
      onError() {
        if (!alive()) return;
        decideToGiveUp("failed", "synthesis");
        if (idleSince === null) settle();
      },
    });
    run.onBuffering?.(true);

    async function audioFor(index: number): Promise<{ audio: NaturalAudio; fromCache: boolean }> {
      const key = sentenceKey({ model: modelId, voice: voice.id, speed: run.rate, text: texts[index] });
      const hit = await cache.get(key).catch(() => null);
      if (hit) return { audio: { samples: pcm16ToFloat(hit.samples), sampleRate: hit.sampleRate }, fromCache: true };
      const t0 = now();
      const audio = await serialize(async () => {
        // A read that was stopped while this waited its turn does not need the sentence.
        if (!alive()) throw new Error("cancelled");
        // The model (hundreds of MB in memory) is read only for a sentence the cache could not answer,
        // so a chapter heard before starts at once and never loads it.
        try {
          await runtime.load(voice);
        } catch (error) {
          throw new ModelLoadFailed(error);
        }
        return runtime.synthesize(texts[index], { voice, speed: run.rate });
      });
      const elapsed = now() - t0;
      // The audio is good whether or not this read is still going.
      void cache.put(key, { samples: floatToPcm16(audio.samples), sampleRate: audio.sampleRate }).catch(() => {});
      if (alive()) {
        const seconds = audio.samples.length / audio.sampleRate;
        synthesized++;
        synthMs += elapsed;
        audioMs += seconds * 1000;
        rtfs.push(seconds > 0 ? elapsed / 1000 / seconds : 0);
        if (rtfs.length >= 3 && rtfs.slice(-3).every((r) => r >= options.slowRtf)) {
          decideToGiveUp("too-slow", "rtf");
        }
      }
      return { audio, fromCache: false };
    }

    void (async () => {
      while (alive() && !giveUp && next < texts.length) {
        // Stay a few sentences ahead of what is being heard, no further.
        if (queuedAny && next - heard > options.ahead) {
          await waitForProgress();
          continue;
        }
        const index = next++;
        let got: { audio: NaturalAudio; fromCache: boolean };
        try {
          got = await audioFor(index);
        } catch (error) {
          if (alive()) decideToGiveUp("failed", error instanceof ModelLoadFailed ? "load" : "synthesis");
          return;
        }
        if (!alive()) return;
        if (got.fromCache) cached++;
        if (giveUp) return;
        if (idleSince !== null) {
          // Playback had run dry waiting for this sentence.
          if (now() - idleSince >= options.stallMs) {
            stalls++;
            if (stalls >= options.maxStalls) {
              // This sentence is ready now, so it plays; stop after what is queued.
              output.enqueue(index, got.audio.samples, got.audio.sampleRate);
              lastQueued = index;
              queuedAny = true;
              idleSince = null;
              decideToGiveUp("too-slow", "underruns");
              return;
            }
          }
        }
        if (!queuedAny && now() - startedAt > options.firstAudioLimitMs) {
          decideToGiveUp("too-slow", "first-audio");
          return;
        }
        output.enqueue(index, got.audio.samples, got.audio.sampleRate);
        lastQueued = index;
        queuedAny = true;
        idleSince = null;
      }
    })();
  }

  function stop() {
    runId++;
    output.close();
    scheduleIdleRelease();
  }

  return {
    speak(text, { rate, voice, onDone, onError }) {
      playRun({
        texts: [text],
        from: 0,
        rate,
        voice,
        onSentence: () => {},
        onDone,
        onError: () => onError(),
      });
    },
    playRun,
    stop,
    async dispose() {
      runId++;
      output.close();
      cancelIdle();
      await serialize(() => runtime.release()).catch(() => {});
    },
  };
}
