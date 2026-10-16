import type { ModelPack } from "./natural-model";

/**
 * The one model pack Listen offers: Kokoro-82M v1.0, full precision (fp32),
 * exported for ExecuTorch (XNNPACK) by Software Mansion, with their Phonemis
 * grapheme-to-phoneme data for English (US and UK), Spanish and Hindi, and the
 * five voices Listen offers.
 *
 * Source: the `software-mansion/react-native-executorch-kokoro` model repository
 * on Hugging Face, pinned to the revision `v0.10.0` that react-native-executorch
 * 0.10.5 itself downloads (ExecuTorch files have no forward compatibility, so the
 * library and these files move together). Model licence: Apache-2.0 (Kokoro-82M
 * by hexgrad; the repository's model card). Phonemis, the phonemizer, is MIT.
 * The sizes below were read from the repository's file listing at that revision;
 * `docs/natural-voice.md` records where they came from and how to update the pack.
 *
 * Why fp32 and not a smaller export: the repository ships fp32 only for Kokoro.
 * One synthesizer serves every language here (German and Polish have their own,
 * which Listen does not offer).
 *
 * Changing the pack means a new `id`: it names the folder and is part of every
 * cached sentence's key.
 */
const REVISION = "v0.10.0";
const BASE = `https://huggingface.co/software-mansion/react-native-executorch-kokoro/resolve/${REVISION}`;

/** Where each file lands under the pack's folder, and how many bytes it is. */
export const KOKORO_FILES = {
  durationPredictor: { path: "xnnpack/standard/duration_predictor_std_xnnpack_fp32.pte", bytes: 59_307_208 },
  synthesizer: { path: "xnnpack/standard/synthesizer_std_xnnpack_fp32.pte", bytes: 272_463_344 },
  // The UK English tagger is the very same file as the US one (same sha256), so it is fetched once.
  enTags: { path: "phonemizer/en-us/tags.json", bytes: 2_161_196 },
  enUsLexicon: { path: "phonemizer/en-us/lexicon.json", bytes: 6_254_348 },
  enUsPhonemizer: { path: "phonemizer/en-us/phonemizer_en_us.pte", bytes: 7_128_528 },
  enGbLexicon: { path: "phonemizer/en-gb/lexicon.json", bytes: 6_664_571 },
  enGbPhonemizer: { path: "phonemizer/en-gb/phonemizer_en_gb.pte", bytes: 7_128_528 },
  esPhonemizer: { path: "phonemizer/es/phonemizer_es.pte", bytes: 7_128_528 },
  hiPhonemizer: { path: "phonemizer/hi/phonemizer_hi.pte", bytes: 9_228_752 },
  voices: {
    af_heart: { path: "voices/af_heart.bin", bytes: 522_240 },
    af_sarah: { path: "voices/af_sarah.bin", bytes: 522_240 },
    bf_emma: { path: "voices/bf_emma.bin", bytes: 522_240 },
    ef_dora: { path: "voices/ef_dora.bin", bytes: 522_240 },
    hf_alpha: { path: "voices/hf_alpha.bin", bytes: 522_240 },
  },
} as const;

/** The grapheme-to-phoneme setups, by the language code Phonemis knows them by. */
export type PhonemizerLanguage = "en-us" | "en-gb" | "es" | "hi";

/** The files a phonemizer is configured with, as paths under the pack's folder. */
export const PHONEMIZER_FILES: Record<PhonemizerLanguage, { tagger?: string; lexicon?: string; neural: string }> = {
  "en-us": { tagger: KOKORO_FILES.enTags.path, lexicon: KOKORO_FILES.enUsLexicon.path, neural: KOKORO_FILES.enUsPhonemizer.path },
  "en-gb": { tagger: KOKORO_FILES.enTags.path, lexicon: KOKORO_FILES.enGbLexicon.path, neural: KOKORO_FILES.enGbPhonemizer.path },
  es: { neural: KOKORO_FILES.esPhonemizer.path },
  hi: { neural: KOKORO_FILES.hiPhonemizer.path },
};

const FILES = [
  KOKORO_FILES.durationPredictor,
  KOKORO_FILES.synthesizer,
  KOKORO_FILES.enTags,
  KOKORO_FILES.enUsLexicon,
  KOKORO_FILES.enUsPhonemizer,
  KOKORO_FILES.enGbLexicon,
  KOKORO_FILES.enGbPhonemizer,
  KOKORO_FILES.esPhonemizer,
  KOKORO_FILES.hiPhonemizer,
  ...Object.values(KOKORO_FILES.voices),
];

export const KOKORO_PACK: ModelPack = {
  id: "kokoro-executorch-v0.10.0-fp32",
  items: FILES.map((f) => ({ path: f.path, url: `${BASE}/${f.path}`, bytes: f.bytes })),
  required: FILES.map((f) => ({ path: f.path, minBytes: f.bytes })),
  source: {
    name: "Software Mansion, Kokoro 82M for ExecuTorch (fp32, XNNPACK)",
    url: "https://huggingface.co/software-mansion/react-native-executorch-kokoro",
    license: "Apache-2.0",
  },
};

export const NATURAL_MODEL_DOWNLOAD_BYTES = KOKORO_PACK.items.reduce((n, i) => n + i.bytes, 0);

/** Megabytes the way the settings screen says them (decimal, like the stores and the OS). */
export function formatMegabytes(bytes: number): string {
  if (bytes > 0 && bytes < 500_000) return "<1 MB";
  return `${Math.round(bytes / 1_000_000)} MB`;
}
