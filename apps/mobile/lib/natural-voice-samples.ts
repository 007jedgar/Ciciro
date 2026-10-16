/**
 * The short clips the writer can play before downloading anything: one per
 * offered voice, about four seconds each (about 110 KB for all five). They are
 * made from the same model the download installs
 * (`scripts/generate-natural-voice-samples.py`, see docs/natural-voice.md), so
 * what is heard is what is delivered.
 *
 * `require` is spelled out per file because Metro bundles assets by static path.
 */
const SAMPLES: Record<string, number> = {
  af_heart: require("../assets/voice-samples/af_heart.mp3"),
  af_sarah: require("../assets/voice-samples/af_sarah.mp3"),
  bf_emma: require("../assets/voice-samples/bf_emma.mp3"),
  ef_dora: require("../assets/voice-samples/ef_dora.mp3"),
  hf_alpha: require("../assets/voice-samples/hf_alpha.mp3"),
};

export function sampleFor(voiceId: string): number | null {
  return SAMPLES[voiceId] ?? null;
}
