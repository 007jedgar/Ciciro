// Shapes and pure rules for "Analyze my style": a proposed style.md and
// character Voice sections drafted from the author's own chapters, for the
// author to review and edit before anything is saved to the bible. Client
// safe: no Prisma, no Anthropic - see src/lib/style-analysis.ts for those.

export type StyleTraitCategory =
  | "pov"
  | "tense"
  | "sentenceRhythm"
  | "diction"
  | "dialogueConventions"
  | "recurringDevices"
  | "avoids";

export const STYLE_TRAIT_ORDER: StyleTraitCategory[] = [
  "pov",
  "tense",
  "sentenceRhythm",
  "diction",
  "dialogueConventions",
  "recurringDevices",
  "avoids",
];

export const STYLE_TRAIT_LABELS: Record<StyleTraitCategory, string> = {
  pov: "POV",
  tense: "Tense",
  sentenceRhythm: "Sentence rhythm",
  diction: "Diction",
  dialogueConventions: "Dialogue conventions",
  recurringDevices: "Recurring devices",
  avoids: "What the author avoids",
};

export type StyleTrait = {
  category: StyleTraitCategory;
  text: string;
  /** A verbatim quote from the sampled chapters backing `text`, or "" if none was found. */
  quote: string;
};

export type CharacterVoiceProposal = {
  path: string;
  name: string;
  voice: string;
  quote: string;
  currentContent: string;
  currentRevision: number;
};

export type StyleAnalysisProposal = {
  traits: StyleTrait[];
  characters: CharacterVoiceProposal[];
  sampledChapters: { id: string; title: string }[];
  currentStyleMd: string;
  currentStyleMdRevision: number;
  proposedStyleMd: string;
};

const MIN_QUOTE_LEN = 3;

/** Loose whitespace-insensitive substring check, for verifying a quote is real. */
export function quoteAppearsIn(quote: string, sample: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const q = norm(quote);
  if (q.length < MIN_QUOTE_LEN) return false;
  return norm(sample).includes(q);
}

type RawTrait = { category?: unknown; text?: unknown; quote?: unknown };
type RawCharacter = { name?: unknown; voice?: unknown; quote?: unknown };
export type ParsedCharacterVoice = { name: string; voice: string; quote: string };

/**
 * Parse the model's JSON reply. A trait keeps its `text` even without
 * evidence (the model is told to say so), but a `quote` that cannot be found
 * verbatim in the sample is dropped to "" rather than trusted - the point of
 * this feature is that every claim is checkable against the author's own
 * prose. A character not in `characterNames` is dropped outright.
 */
export function parseStyleAnalysisJson(
  raw: string,
  opts: { sampleText: string; characterNames: string[] }
): { traits: StyleTrait[]; characters: ParsedCharacterVoice[] } | null {
  const trimmed = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const src = parsed as { traits?: unknown; characters?: unknown };
  if (!Array.isArray(src.traits)) return null;

  const byCategory = new Map<StyleTraitCategory, StyleTrait>();
  for (const item of src.traits as RawTrait[]) {
    if (!item || typeof item !== "object") continue;
    const category = item.category as StyleTraitCategory;
    if (!STYLE_TRAIT_ORDER.includes(category)) continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    const rawQuote = typeof item.quote === "string" ? item.quote.trim() : "";
    const quote = rawQuote && quoteAppearsIn(rawQuote, opts.sampleText) ? rawQuote : "";
    byCategory.set(category, { category, text, quote });
  }
  const traits = STYLE_TRAIT_ORDER.filter((c) => byCategory.has(c)).map((c) => byCategory.get(c)!);

  const knownNames = new Set(opts.characterNames.map((n) => n.toLowerCase()));
  const characters: ParsedCharacterVoice[] = [];
  if (Array.isArray(src.characters)) {
    for (const item of src.characters as RawCharacter[]) {
      if (!item || typeof item !== "object") continue;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name || !knownNames.has(name.toLowerCase())) continue;
      const voice = typeof item.voice === "string" ? item.voice.trim() : "";
      if (!voice) continue;
      const rawQuote = typeof item.quote === "string" ? item.quote.trim() : "";
      const quote = rawQuote && quoteAppearsIn(rawQuote, opts.sampleText) ? rawQuote : "";
      characters.push({ name, voice, quote });
    }
  }
  return { traits, characters };
}

/** A short style.md built from the proposed traits, one bullet per category. */
export function renderProposedStyleMd(traits: StyleTrait[]): string {
  const lines = ["# Style", "> Voice, POV, tense, prose rules, and dialogue conventions.", ""];
  for (const category of STYLE_TRAIT_ORDER) {
    const trait = traits.find((t) => t.category === category);
    if (!trait) continue;
    lines.push(`- **${STYLE_TRAIT_LABELS[category]}:** ${trait.text}`);
    if (trait.quote) lines.push(`  > "${trait.quote}"`);
  }
  return lines.join("\n") + "\n";
}

const VOICE_HEADING_RE = /^##\s+voice\s*$/im;

/**
 * Replace a character file's Voice section (see emptyCharacterFile in
 * src/lib/bible.ts) with new body text, preserving every other section.
 * Appends a Voice section at the end if the file has none.
 */
export function replaceVoiceSection(fileContent: string, voiceBody: string): string {
  const section = ["## Voice", voiceBody.trim()].filter(Boolean).join("\n");
  const match = VOICE_HEADING_RE.exec(fileContent);
  if (!match) {
    const before = fileContent.replace(/\s*$/, "");
    return before ? `${before}\n\n${section}\n` : `${section}\n`;
  }
  const before = fileContent.slice(0, match.index).replace(/\s*$/, "");
  const rest = fileContent.slice(match.index + match[0].length);
  const nextHeading = /\n##\s+/.exec(rest);
  const after = (nextHeading ? rest.slice(nextHeading.index) : "").replace(/^\s*/, "");
  const head = [before, section].filter(Boolean).join("\n\n");
  return after ? `${head}\n\n${after}\n` : `${head}\n`;
}
