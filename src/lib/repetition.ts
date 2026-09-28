// Deterministic (non-LLM) repetition detector: flags words and phrases used
// above a frequency threshold, per chapter and across the manuscript. It never
// edits prose; it only reports what to look at. Takes plain text (already
// stripped of HTML by the caller - see src/lib/text.ts's chapterPlainText) so
// it stays a small, easily portable module with no DOM or Prisma dependency.

/** A flagged word or phrase with how often it showed up. */
export type RepetitionFlag = {
  text: string;
  count: number;
  /** Occurrences per 1,000 words analyzed, so chapters of different lengths compare fairly. */
  perThousand: number;
};

export type RepetitionReport = {
  wordsAnalyzed: number;
  words: RepetitionFlag[];
  phrases: RepetitionFlag[];
};

export type ChapterRepetitionReport = RepetitionReport & {
  chapterId: string;
  chapterTitle: string;
  /** 1-based position among the manuscript's live chapters. */
  chapterNumber: number;
};

export type ManuscriptRepetitionReport = {
  chapters: ChapterRepetitionReport[];
  manuscript: RepetitionReport;
};

/** One chapter's plain-text prose, ready to analyze. */
export type ChapterText = { id: string; title: string; number: number; text: string };

export type RepetitionThresholds = {
  /** A word needs at least this many occurrences before it can be flagged. */
  minWordCount: number;
  /** ...or this many per 1,000 words analyzed, whichever is higher. */
  wordRatePer1000: number;
  /** A phrase needs at least this many occurrences before it can be flagged. */
  minPhraseCount: number;
  /** ...or this many per 1,000 words analyzed, whichever is higher. */
  phraseRatePer1000: number;
  /** Phrase (n-gram) lengths to check, in words. */
  phraseLengths: number[];
  /** How many flags of each kind (words, phrases) to keep, highest count first. */
  limit: number;
};

export const DEFAULT_THRESHOLDS: RepetitionThresholds = {
  minWordCount: 5,
  wordRatePer1000: 4,
  minPhraseCount: 3,
  phraseRatePer1000: 1.5,
  phraseLengths: [2, 3, 4],
  limit: 40,
};

// A standard English stop-word list. These are ignored as single-word flags
// (nobody needs to be told "the" repeats) and, combined with character names,
// decide which phrases are pure filler (see isFiller below).
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before",
  "being", "below", "between", "both", "but", "by", "can", "could", "couldn't",
  "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during",
  "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here",
  "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i",
  "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's",
  "its", "itself", "just", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or",
  "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same",
  "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
  "some", "such", "than", "that", "that's", "the", "their", "theirs", "them",
  "themselves", "then", "there", "there's", "these", "they", "they'd",
  "they'll", "they're", "they've", "this", "those", "through", "to", "too",
  "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll",
  "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
  "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's",
  "with", "won't", "would", "wouldn't", "you", "you'd", "you'll", "you're",
  "you've", "your", "yours", "yourself", "yourselves",
]);

// Letters/digits, with an internal apostrophe kept so contractions and
// possessives ("don't", "Marta's") stay one token.
const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function tokenize(paragraph: string): string[] {
  const out: string[] = [];
  for (const m of paragraph.matchAll(WORD_RE)) out.push(m[0].toLowerCase());
  return out;
}

/** Tokens of a chapter's plain text, one array per paragraph so a phrase never spans a paragraph break. */
function paragraphTokens(text: string): string[][] {
  const paragraphs: string[][] = [];
  for (const para of text.split(/\n+/)) {
    const tokens = tokenize(para);
    if (tokens.length > 0) paragraphs.push(tokens);
  }
  return paragraphs;
}

/** A token stripped of a trailing possessive, for matching against the exclusion set. */
function baseToken(token: string): string {
  return token.replace(/['’]s$/i, "");
}

/** The word tokens making up a bible character's name (e.g. "Marta Chen" -> ["marta", "chen"]). */
export function nameTokens(name: string): string[] {
  const out: string[] = [];
  for (const m of name.matchAll(WORD_RE)) out.push(m[0].toLowerCase());
  return out;
}

/** Stop words plus every token of every given character name, lowercased. */
export function buildExclusionSet(characterNames: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>(STOP_WORDS);
  for (const name of characterNames) {
    for (const token of nameTokens(name)) set.add(token);
  }
  return set;
}

/** True when every token of a word or phrase is a stop word or a character name - pure filler. */
function isFiller(displayText: string, excluded: ReadonlySet<string>): boolean {
  return displayText.split(" ").every((t) => excluded.has(baseToken(t)));
}

type Counts = { words: Map<string, number>; phrases: Map<string, number>; wordsAnalyzed: number };

function collectCounts(text: string, phraseLengths: readonly number[]): Counts {
  const words = new Map<string, number>();
  const phrases = new Map<string, number>();
  let wordsAnalyzed = 0;
  for (const tokens of paragraphTokens(text)) {
    wordsAnalyzed += tokens.length;
    for (const t of tokens) words.set(t, (words.get(t) ?? 0) + 1);
    for (const n of phraseLengths) {
      if (n < 2) continue;
      for (let i = 0; i + n <= tokens.length; i++) {
        const phrase = tokens.slice(i, i + n).join(" ");
        phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
      }
    }
  }
  return { words, phrases, wordsAnalyzed };
}

function mergeCounts(into: Map<string, number>, from: Map<string, number>): void {
  for (const [key, value] of from) into.set(key, (into.get(key) ?? 0) + value);
}

function flagsFromCounts(
  counts: Map<string, number>,
  wordsAnalyzed: number,
  excluded: ReadonlySet<string>,
  minCount: number,
  ratePer1000: number,
  limit: number
): RepetitionFlag[] {
  const threshold = Math.max(minCount, Math.ceil((ratePer1000 * wordsAnalyzed) / 1000));
  const flags: RepetitionFlag[] = [];
  for (const [text, count] of counts) {
    if (count < threshold) continue;
    if (isFiller(text, excluded)) continue;
    flags.push({
      text,
      count,
      perThousand: wordsAnalyzed > 0 ? Math.round((count / wordsAnalyzed) * 1000 * 10) / 10 : 0,
    });
  }
  flags.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return flags.slice(0, limit);
}

function reportFromCounts(
  counts: Counts,
  excluded: ReadonlySet<string>,
  thresholds: RepetitionThresholds
): RepetitionReport {
  return {
    wordsAnalyzed: counts.wordsAnalyzed,
    words: flagsFromCounts(
      counts.words,
      counts.wordsAnalyzed,
      excluded,
      thresholds.minWordCount,
      thresholds.wordRatePer1000,
      thresholds.limit
    ),
    phrases: flagsFromCounts(
      counts.phrases,
      counts.wordsAnalyzed,
      excluded,
      thresholds.minPhraseCount,
      thresholds.phraseRatePer1000,
      thresholds.limit
    ),
  };
}

/** Overused words and phrases in one piece of plain text (e.g. one chapter). */
export function analyzeRepetitionText(
  text: string,
  characterNames: readonly string[] = [],
  thresholds: RepetitionThresholds = DEFAULT_THRESHOLDS
): RepetitionReport {
  const excluded = buildExclusionSet(characterNames);
  return reportFromCounts(collectCounts(text, thresholds.phraseLengths), excluded, thresholds);
}

/** Overused words and phrases per chapter, plus the same across the whole manuscript. */
export function analyzeManuscriptRepetition(
  chapters: readonly ChapterText[],
  characterNames: readonly string[] = [],
  thresholds: RepetitionThresholds = DEFAULT_THRESHOLDS
): ManuscriptRepetitionReport {
  const excluded = buildExclusionSet(characterNames);
  const totalWords = new Map<string, number>();
  const totalPhrases = new Map<string, number>();
  let totalAnalyzed = 0;

  const chapterReports = chapters.map((chapter) => {
    const counts = collectCounts(chapter.text, thresholds.phraseLengths);
    mergeCounts(totalWords, counts.words);
    mergeCounts(totalPhrases, counts.phrases);
    totalAnalyzed += counts.wordsAnalyzed;
    const report = reportFromCounts(counts, excluded, thresholds);
    return {
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      chapterNumber: chapter.number,
      ...report,
    };
  });

  const manuscript = reportFromCounts(
    { words: totalWords, phrases: totalPhrases, wordsAnalyzed: totalAnalyzed },
    excluded,
    thresholds
  );

  return { chapters: chapterReports, manuscript };
}
