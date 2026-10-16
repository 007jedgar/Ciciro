/**
 * Kokoro on the device through react-native-executorch: the `NaturalRuntime`
 * the engine drives. The package is loaded on first use, so tests and the web
 * never touch the native library.
 *
 * ExecuTorch runs the model on its own worklet thread, never the JS thread, and
 * Phonemis (MIT) turns text into sounds. One loaded instance serves one
 * phonemizer (US English, UK English, Spanish or Hindi), so a voice from another
 * one reloads the model; a chapter is in one language, so that is rare.
 */
import type { NaturalRuntime } from "./kokoro-engine";
import { KOKORO_FILES, PHONEMIZER_FILES, type PhonemizerLanguage } from "./natural-pack";
import { NATURAL_VOICES, phonemizerFor } from "./natural-voice";

type KokoroChunk = { audio: Float32Array; sampleRate: number };

type KokoroTts = {
  synthesize(text: string, options: { voice: string; speed: number }): AsyncGenerator<KokoroChunk>;
  synthesizeStop(): void;
  dispose(): void;
};

type KokoroConfig = {
  name: "kokoro";
  modelPaths: { durationPredictor: string; synthesizer: string };
  phonemizer: { lang: PhonemizerLanguage; taggerSource?: string; lexiconSource?: string; neuralModelSource: string };
  voices: Record<string, string>;
};

type ExecuTorchApi = {
  createKokoroTextToSpeech(config: KokoroConfig): Promise<KokoroTts>;
};

export type ExecuTorchRuntimeOptions = {
  /** The folder the model pack is installed in, as a plain path, or null when it is not installed. */
  modelPath: () => string | null;
  /** Only for tests: stands in for the native module. */
  api?: ExecuTorchApi;
};

/** Kokoro's sample rate; also what the silence for an empty sentence is made at. */
const SAMPLE_RATE = 24_000;
/** The speeds ExecuTorch's Kokoro accepts. */
const MIN_SPEED = 0.1;
const MAX_SPEED = 3;

const voiceFile = (id: string): string | undefined => (KOKORO_FILES.voices as Record<string, { path: string }>)[id]?.path;

/** The config for one phonemizer: the shared models, its own G2P files and the voices it speaks. */
export function kokoroConfigFor(dir: string, g2p: PhonemizerLanguage): KokoroConfig {
  const at = (relative: string) => `${dir}/${relative}`;
  const files = PHONEMIZER_FILES[g2p];
  const voices: Record<string, string> = {};
  for (const voice of NATURAL_VOICES) {
    const file = voiceFile(voice.id);
    if (phonemizerFor(voice) === g2p && file) voices[voice.id] = at(file);
  }
  return {
    name: "kokoro",
    modelPaths: { durationPredictor: at(KOKORO_FILES.durationPredictor.path), synthesizer: at(KOKORO_FILES.synthesizer.path) },
    phonemizer: {
      lang: g2p,
      ...(files.tagger ? { taggerSource: at(files.tagger) } : {}),
      ...(files.lexicon ? { lexiconSource: at(files.lexicon) } : {}),
      neuralModelSource: at(files.neural),
    },
    voices,
  };
}

export function createExecuTorchRuntime(options: ExecuTorchRuntimeOptions): NaturalRuntime {
  let current: { g2p: PhonemizerLanguage; tts: KokoroTts } | null = null;

  const release = async () => {
    const active = current;
    current = null;
    if (!active) return;
    try {
      active.tts.synthesizeStop();
    } catch {
      /* nothing was running */
    }
    active.tts.dispose();
  };

  return {
    async load(voice) {
      const g2p = phonemizerFor(voice);
      if (current?.g2p === g2p) return;
      // A different phonemizer is a different instance; two would hold the model in memory twice.
      await release();
      const dir = options.modelPath();
      if (!dir) throw new Error("The natural voice is not installed.");
      const api = options.api ?? (require("react-native-executorch") as ExecuTorchApi);
      current = { g2p, tts: await api.createKokoroTextToSpeech(kokoroConfigFor(dir, g2p)) };
    },
    async synthesize(text, { voice, speed }) {
      const active = current;
      if (!active || active.g2p !== phonemizerFor(voice)) throw new Error("The natural voice is not loaded.");
      const parts: KokoroChunk[] = [];
      let length = 0;
      // A sentence comes back in pieces when it is long; the pieces are copied out at once.
      for await (const chunk of active.tts.synthesize(text, { voice: voice.id, speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) })) {
        parts.push({ audio: Float32Array.from(chunk.audio), sampleRate: chunk.sampleRate });
        length += chunk.audio.length;
      }
      // Nothing to say (a sentence of only punctuation): a beat of silence keeps the queue and the highlight moving.
      if (length === 0) return { samples: new Float32Array(SAMPLE_RATE / 20), sampleRate: SAMPLE_RATE };
      const samples = new Float32Array(length);
      let at = 0;
      for (const part of parts) {
        samples.set(part.audio, at);
        at += part.audio.length;
      }
      return { samples, sampleRate: parts[0].sampleRate };
    },
    release,
  };
}
