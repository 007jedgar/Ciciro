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

function normalizeForMatch(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Loose substring check for verifying a quote is real: ignores whitespace,
 * case, and curly-versus-straight quotes and apostrophes.
 */
export function quoteAppearsIn(quote: string, sample: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_LEN) return false;
  return normalizeForMatch(sample).includes(q);
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

function traitLines(traits: StyleTrait[]): string[] {
  const lines: string[] = [];
  for (const category of STYLE_TRAIT_ORDER) {
    const trait = traits.find((t) => t.category === category);
    if (!trait) continue;
    lines.push(`- **${STYLE_TRAIT_LABELS[category]}:** ${trait.text}`);
    if (trait.quote) lines.push(`  > "${trait.quote}"`);
  }
  return lines;
}

/** A short style.md built from the proposed traits, one bullet per category. */
export function renderProposedStyleMd(traits: StyleTrait[]): string {
  const lines = ["# Style", "> Voice, POV, tense, prose rules, and dialogue conventions.", ""];
  lines.push(...traitLines(traits));
  return lines.join("\n") + "\n";
}

export const ANALYZED_STYLE_HEADING = "## Analyzed from my prose";

/**
 * The style.md draft to offer the author: their existing file kept intact,
 * plus only the proposed traits whose text it doesn't already contain,
 * gathered under ANALYZED_STYLE_HEADING. When a previous analysis already
 * added that section, a trait replaces the bullet (and quote line) for its
 * own category there rather than stacking a second one beside it. An empty
 * file gets the full proposal.
 */
export function mergeProposedStyleMd(currentStyleMd: string, traits: StyleTrait[]): string {
  const current = currentStyleMd.replace(/\s*$/, "");
  if (!current.trim()) return renderProposedStyleMd(traits);
  const existing = normalizeForMatch(current);
  const fresh = traits.filter((t) => !existing.includes(normalizeForMatch(t.text)));
  if (fresh.length === 0) return `${current}\n`;

  const headingAt = current.indexOf(ANALYZED_STYLE_HEADING);
  if (headingAt === -1) {
    return `${current}\n\n${ANALYZED_STYLE_HEADING}\n${traitLines(fresh).join("\n")}\n`;
  }
  const bodyStart = headingAt + ANALYZED_STYLE_HEADING.length;
  const nextHeading = /\n##?\s+/.exec(current.slice(bodyStart));
  const sectionEnd = nextHeading ? bodyStart + nextHeading.index : current.length;
  const before = current.slice(0, bodyStart);
  const after = current.slice(sectionEnd).replace(/^\s*/, "");

  const body = current.slice(bodyStart, sectionEnd).replace(/^\n/, "").replace(/\s*$/, "");
  const lines = body ? body.split("\n") : [];
  for (const trait of fresh) {
    const replacement = traitLines([trait]);
    const bullet = `- **${STYLE_TRAIT_LABELS[trait.category]}:**`;
    const start = lines.findIndex((l) => l.startsWith(bullet));
    if (start === -1) {
      lines.push(...replacement);
      continue;
    }
    let end = start + 1;
    while (end < lines.length && /^\s+>/.test(lines[end])) end++;
    lines.splice(start, end - start, ...replacement);
  }
  const section = `${before}\n${lines.join("\n")}`;
  return after ? `${section}\n\n${after}\n` : `${section}\n`;
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
