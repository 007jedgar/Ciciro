import {
  chooseSpeechEngine,
  DEFAULT_NATURAL_VOICE,
  detectTextLanguage,
  NATURAL_LANGUAGES,
  NATURAL_VOICES,
  naturalVoiceById,
  naturalVoicesFor,
  phonemizerFor,
} from "../lib/natural-voice";
import { KOKORO_FILES, PHONEMIZER_FILES } from "../lib/natural-pack";
import { sampleFor } from "../lib/natural-voice-samples";

const EN =
  'The ferry to Inishmaan left at dawn, and Saoirse was the only passenger who had not been sick. "You\'re sure about this?" asked Captain Wyndham, squinting at the sky.';
const ES =
  "El ferry a Inishmaan salió al amanecer, y Xochitl era la única pasajera que no se había mareado. «¿Está segura?», preguntó el capitán. Nadie va a la isla en octubre.";
const HI = "इनिशमान जाने वाली नाव भोर में रवाना हुई। कप्तान विंडहम ने आसमान की ओर देखते हुए पूछा।";
const ZH = "渡轮在黎明时分驶离了伊尼什曼岛。“你确定吗？”船长温德姆眯着眼睛望向天空。";
const FR = "Le ferry pour Inishmaan est parti à l'aube, et elle était la seule passagère qui n'avait pas été malade. Il ne dit pas un mot.";
const DE = "Die Fähre nach Inishmaan fuhr im Morgengrauen ab, und sie war die einzige, die nicht seekrank geworden war. Es war nicht leicht.";

describe("the voice catalog", () => {
  it("offers only voices whose ids are unique", () => {
    expect(new Set(NATURAL_VOICES.map((v) => v.id)).size).toBe(NATURAL_VOICES.length);
  });

  it("has a default voice that exists for every language it lists", () => {
    for (const language of NATURAL_LANGUAGES) {
      const voice = naturalVoiceById(DEFAULT_NATURAL_VOICE[language]);
      expect(voice?.language).toBe(language);
      expect(naturalVoicesFor(language).length).toBeGreaterThan(0);
    }
  });

  it("pins the voice ids, which are stored in prefs and carried by analytics", () => {
    expect(NATURAL_VOICES.map((v) => v.id)).toEqual(["af_heart", "af_sarah", "bf_emma", "ef_dora", "hf_alpha"]);
  });

  it("gives every voice a file in the model pack, a sample clip and a phonemizer the pack carries", () => {
    for (const voice of NATURAL_VOICES) {
      expect(Object.keys(KOKORO_FILES.voices)).toContain(voice.id);
      expect(sampleFor(voice.id)).not.toBeNull();
      const files = PHONEMIZER_FILES[phonemizerFor(voice)];
      expect(files.neural).toMatch(/\.pte$/);
    }
  });

  it("offers no voice the pack does not ship", () => {
    const ids = NATURAL_VOICES.map((v) => v.id).sort();
    expect(Object.keys(KOKORO_FILES.voices).sort()).toEqual(ids);
  });

  it("picks the phonemizer from the voice's accent", () => {
    const by = (id: string) => phonemizerFor(naturalVoiceById(id)!);
    expect(by("af_heart")).toBe("en-us");
    expect(by("bf_emma")).toBe("en-gb");
    expect(by("ef_dora")).toBe("es");
    expect(by("hf_alpha")).toBe("hi");
  });

  it("does not offer a Mandarin voice (Kokoro grades them all D)", () => {
    expect(NATURAL_VOICES.some((v) => v.id.startsWith("z"))).toBe(false);
  });
});

describe("detectTextLanguage", () => {
  it("tells English, Spanish and Hindi apart", () => {
    expect(detectTextLanguage(EN)).toBe("en");
    expect(detectTextLanguage(ES)).toBe("es");
    expect(detectTextLanguage(HI)).toBe("hi");
  });

  it("gives other writing systems and other Latin languages no natural voice", () => {
    expect(detectTextLanguage(ZH)).toBe("other");
    expect(detectTextLanguage(FR)).toBe("other");
    expect(detectTextLanguage(DE)).toBe("other");
  });

  it("is not thrown by a Hindi chapter with a few English names", () => {
    expect(detectTextLanguage(`${HI} Inishmaan Wyndham`)).toBe("hi");
  });

  it("counts Spanish-only characters as evidence on short text", () => {
    expect(detectTextLanguage("¿Qué pasó, señor?")).toBe("es");
  });

  it("falls back to the device language when the text is too short to judge", () => {
    expect(detectTextLanguage("Hola.", "es-MX")).toBe("es");
    expect(detectTextLanguage("Hello.", "fr-FR")).toBe("en");
    expect(detectTextLanguage("", "hi-IN")).toBe("hi");
    expect(detectTextLanguage("123 456 !!", "")).toBe("en");
  });
});

describe("chooseSpeechEngine", () => {
  const base = {
    preferred: null,
    modelReady: true,
    nativeAvailable: true,
    language: "en" as const,
    voices: {},
  };

  it("keeps the system voice until a model is on the device", () => {
    expect(chooseSpeechEngine({ ...base, modelReady: false })).toEqual({ kind: "system", reason: "preferred" });
  });

  it("moves a writer who never chose to the natural voice once the model is ready", () => {
    expect(chooseSpeechEngine(base)).toEqual({ kind: "natural", voice: naturalVoiceById("af_heart") });
  });

  it("honours an explicit system choice even with the model ready", () => {
    expect(chooseSpeechEngine({ ...base, preferred: "system" })).toEqual({ kind: "system", reason: "preferred" });
  });

  it("falls back to the system voice when the natural choice cannot work", () => {
    expect(chooseSpeechEngine({ ...base, preferred: "natural", modelReady: false })).toEqual({
      kind: "system",
      reason: "not-downloaded",
    });
    expect(chooseSpeechEngine({ ...base, preferred: "natural", nativeAvailable: false })).toEqual({
      kind: "system",
      reason: "unavailable",
    });
    expect(chooseSpeechEngine({ ...base, preferred: "natural", language: "other" })).toEqual({
      kind: "system",
      reason: "unsupported-language",
    });
  });

  it("uses the voice saved for the text's language and ignores a stale or mismatched one", () => {
    expect(chooseSpeechEngine({ ...base, voices: { en: "bf_emma" } })).toEqual({
      kind: "natural",
      voice: naturalVoiceById("bf_emma"),
    });
    expect(chooseSpeechEngine({ ...base, language: "es", voices: { es: "af_heart" } })).toEqual({
      kind: "natural",
      voice: naturalVoiceById("ef_dora"),
    });
    expect(chooseSpeechEngine({ ...base, voices: { en: "removed_voice" } })).toEqual({
      kind: "natural",
      voice: naturalVoiceById("af_heart"),
    });
  });
});
