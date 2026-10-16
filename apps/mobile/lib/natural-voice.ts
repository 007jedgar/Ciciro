/**
 * Natural voices: the Kokoro voices Listen offers, which one reads a given
 * text, and when the phone's own voices read instead. Pure, no native modules.
 *
 * Voice ids are permanent: they are stored in local prefs and carried by
 * analytics. An id is the voice's own name in Kokoro (`af_heart`), which is also
 * the name of its voice file in the model pack, so a voice here needs a file in
 * `natural-pack.ts` too. Voices are Kokoro's own, but which ones exist depends on
 * the runtime that reads them (each runtime ships its own set), so a runtime
 * change can add or retire one.
 */
import type { PhonemizerLanguage } from "./natural-pack";

export type NaturalLanguage = "en" | "es" | "hi";

/** What a chapter is written in, as far as Listen can tell. "other" has no natural voice. */
export type TextLanguage = NaturalLanguage | "other";

export type NaturalVoice = {
  /** Kokoro's name for the voice, and the name of its voice file. */
  id: string;
  language: NaturalLanguage;
  /** Which accent of the language, for the label. */
  accent: "us" | "gb" | "es" | "hi";
  gender: "female" | "male";
};

/**
 * The voices worth offering from what the runtime ships: Kokoro's best English
 * voices it has (`af_heart`, and `bf_emma` for UK English; `af_sarah` stands in
 * for `af_bella`, which the runtime does not ship), and its one Spanish and one
 * Hindi voice, checked by speech recognition (the Spanish one reads back cleanly,
 * the Hindi one less so; neither has been auditioned by ear yet). Mandarin is
 * left to the system voice (Kokoro grades every Mandarin voice D).
 */
export const NATURAL_VOICES: readonly NaturalVoice[] = [
  { id: "af_heart", language: "en", accent: "us", gender: "female" },
  { id: "af_sarah", language: "en", accent: "us", gender: "female" },
  { id: "bf_emma", language: "en", accent: "gb", gender: "female" },
  { id: "ef_dora", language: "es", accent: "es", gender: "female" },
  { id: "hf_alpha", language: "hi", accent: "hi", gender: "female" },
];

const PHONEMIZER_OF_ACCENT: Record<NaturalVoice["accent"], PhonemizerLanguage> = {
  us: "en-us",
  gb: "en-gb",
  es: "es",
  hi: "hi",
};

/** Which grapheme-to-phoneme setup turns text into the sounds this voice is spoken in. */
export function phonemizerFor(voice: NaturalVoice): PhonemizerLanguage {
  return PHONEMIZER_OF_ACCENT[voice.accent];
}

export const DEFAULT_NATURAL_VOICE: Record<NaturalLanguage, string> = {
  en: "af_heart",
  es: "ef_dora",
  hi: "hf_alpha",
};

export function naturalVoiceById(id: string | null | undefined): NaturalVoice | null {
  return NATURAL_VOICES.find((v) => v.id === id) ?? null;
}

/** The name a voice goes by on screen: `af_heart` is "Heart". Voice names are not translated. */
export function naturalVoiceName(id: string): string {
  const name = id.split("_")[1] ?? id;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function naturalVoicesFor(language: NaturalLanguage): NaturalVoice[] {
  return NATURAL_VOICES.filter((v) => v.language === language);
}

/** The languages that have a natural voice, in the order the settings screen lists them. */
export const NATURAL_LANGUAGES: readonly NaturalLanguage[] = ["en", "es", "hi"];

// Function words that tell the Latin-script languages apart. Words two of the
// languages share ("a", "no", "me", "se", "e", "la" in French and Spanish) are
// left out, so a hit votes for one language only.
const STOPWORDS: Record<"en" | "es" | "fr" | "de" | "it" | "pt", string[]> = {
  en: "the and of to in that is it was he she you for with on as his her they had not but at be this have from or were said there what when would".split(" "),
  es: "el los las un una de que y en por con para su es lo del al como pero más está fue era muy ya sí mi tu ella él nada sobre cuando porque también esta eso aquí".split(" "),
  fr: "le les des et est que qui dans pour pas sur avec il elle nous vous ce ne au du je mais ou été une c'est qu'il j'ai n'est".split(" "),
  de: "der die das und ist nicht ein eine zu den mit von sie er es ich auf für im dem sich auch wie aber als war".split(" "),
  it: "il gli di che è per non con si ma come anche della sono ho mi ti ci nel una dei alla".split(" "),
  pt: "os as um uma que em para com não mais como mas foi ele ela do da dos das no na você está são".split(" "),
};

const STOPWORD_SETS = Object.fromEntries(
  Object.entries(STOPWORDS).map(([language, words]) => [language, new Set(words)])
) as Record<keyof typeof STOPWORDS, Set<string>>;

/** Fewer function-word hits than this and the text is too short to judge by its words. */
const MIN_STOPWORD_HITS = 3;

/** Share of letters in another writing system that makes the text "not Latin". */
const NON_LATIN_SHARE = 0.3;

/**
 * Which language a chapter's text is in, from its writing system and its
 * function words. `deviceLocale` settles the text too short to judge. French,
 * German, Italian and Portuguese come back as "other": no natural voice reads
 * them, and an English voice reading French is worse than the system voice.
 */
export function detectTextLanguage(text: string, deviceLocale = ""): TextLanguage {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return fallbackLanguage(deviceLocale);
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  const devanagari = letters.filter((c) => /\p{Script=Devanagari}/u.test(c)).length;
  if ((letters.length - latin) / letters.length >= NON_LATIN_SHARE) {
    return devanagari >= (letters.length - latin) / 2 ? "hi" : "other";
  }

  const words = text.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];
  const scores = Object.entries(STOPWORD_SETS).map(([language, set]) => ({
    language: language as keyof typeof STOPWORDS,
    hits: words.reduce((n, w) => n + (set.has(w.replace("’", "'")) ? 1 : 0), 0),
  }));
  // Characters only Spanish uses are strong evidence on their own.
  const spanishMarks = (text.match(/[¿¡ñ]/g) ?? []).length * 3;
  const es = scores.find((s) => s.language === "es");
  if (es) es.hits += spanishMarks;
  scores.sort((a, b) => b.hits - a.hits);
  const best = scores[0];
  if (!best || best.hits < MIN_STOPWORD_HITS || best.hits === scores[1]?.hits) {
    return fallbackLanguage(deviceLocale);
  }
  return best.language === "en" || best.language === "es" ? best.language : "other";
}

function fallbackLanguage(deviceLocale: string): TextLanguage {
  const base = deviceLocale.split(/[-_]/)[0]?.toLowerCase();
  return base === "es" || base === "hi" ? base : "en";
}

export type EnginePreference = "system" | "natural";

export type EngineChoice =
  | { kind: "natural"; voice: NaturalVoice }
  | {
      kind: "system";
      /**
       * Why: the writer chose it ("preferred"), the model is not on the device
       * ("not-downloaded"), the text is in a language no natural voice reads
       * ("unsupported-language"), or the native pieces are missing ("unavailable").
       */
      reason: "preferred" | "not-downloaded" | "unsupported-language" | "unavailable";
    };

/**
 * Who reads. System voices are the default until a natural model is on the
 * device; once it is, a writer who has not chosen gets the natural voice. A
 * natural choice still falls back to the system voice when it cannot work.
 */
export function chooseSpeechEngine(input: {
  /** The writer's explicit choice, or null to take whatever is best available. */
  preferred: EnginePreference | null;
  modelReady: boolean;
  /** False where the native audio or speech module is missing (web, Expo Go, tests). */
  nativeAvailable: boolean;
  language: TextLanguage;
  /** The voice the writer picked for each language. */
  voices: Partial<Record<NaturalLanguage, string>>;
}): EngineChoice {
  const wanted = input.preferred ?? (input.modelReady ? "natural" : "system");
  if (wanted === "system") return { kind: "system", reason: "preferred" };
  if (!input.nativeAvailable) return { kind: "system", reason: "unavailable" };
  if (!input.modelReady) return { kind: "system", reason: "not-downloaded" };
  if (input.language === "other") return { kind: "system", reason: "unsupported-language" };
  const saved = naturalVoiceById(input.voices[input.language]);
  const voice =
    saved && saved.language === input.language
      ? saved
      : (naturalVoiceById(DEFAULT_NATURAL_VOICE[input.language]) as NaturalVoice);
  return { kind: "natural", voice };
}
