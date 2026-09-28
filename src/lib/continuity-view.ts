// Shapes and pure helpers for the continuity check: which bible files are
// relevant to a chapter, and how the model's JSON reply is parsed into
// findings. No DB or network access here so the matching and prompt-building
// logic can be unit tested without mocking Anthropic or Prisma; see
// src/lib/continuity.ts for the parts that touch the database and the model.

import { findMatches, MAX_QUERY_LENGTH } from "@/lib/manuscript-search";

export type BibleIndexEntry = { path: string; summary: string };

export type ContinuityFinding = {
  /** Verbatim substring of the chapter that makes the claim. */
  chapterQuote: string;
  /** Which bible file the contradicted line came from. */
  canonFile: string;
  /** Verbatim substring of that bible file. */
  canonQuote: string;
  /** One sentence naming the contradiction. */
  note: string;
};

export type ContinuityCheckFinding = ContinuityFinding & {
  chapterId: string;
  chapterTitle: string;
};

export type ContinuityScope = "chapter" | "book";

export type ContinuityCheckResult = {
  scope: ContinuityScope;
  findings: ContinuityCheckFinding[];
  /** Chapters the run could not check (a failed call, or out of time). */
  unchecked: { chapterId: string; chapterTitle: string }[];
};

export const MAX_BIBLE_CHARS = 6000;
export const MAX_CHAPTER_CHARS = 20000;
const QUOTE_MAX = 400;
const NOTE_MAX = 300;
const FINDINGS_MAX = 20;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NAME_TOKEN_MIN = 3;
const TITLES = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "lord", "lady", "king", "queen",
  "prince", "princess", "captain", "capt", "general", "colonel", "major", "sergeant", "officer",
  "detective", "inspector", "professor", "prof", "father", "mother", "sister", "brother",
  "aunt", "uncle", "saint", "st", "the", "and", "of", "von", "van", "der", "del", "de", "la", "le",
]);

/**
 * Words that identify a character file: every token of the de-slugged path
 * and of the name that opens the index summary, minus short tokens and
 * titles, so "sherlock-holmes" matches a chapter that only says "Holmes".
 */
function nameTokens(entry: BibleIndexEntry): string[] {
  const slugName = entry.path.replace(/^characters\//, "").replace(/\.md$/, "");
  const summaryName = entry.summary.split(/[-–,(]/)[0] ?? "";
  const tokens = `${slugName} ${summaryName}`
    .split(/[^\p{L}\p{N}_']+/u)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length >= NAME_TOKEN_MIN && !TITLES.has(t.toLowerCase()));
  return Array.from(new Set(tokens.map((t) => t.toLowerCase())));
}

/** True when the token appears as a whole word, with Unicode letters counting as word characters. */
function mentionsName(text: string, token: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(token)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/**
 * Character bible files worth sending for this chapter: only the ones whose
 * name is actually mentioned in the text. This is the bound on token cost -
 * a manuscript with a large cast never sends every character sheet for a
 * scene that names two people.
 */
export function relevantCharacterPaths(index: BibleIndexEntry[], chapterText: string): string[] {
  return index
    .filter((e) => e.path.startsWith("characters/"))
    .filter((e) => nameTokens(e).some((token) => mentionsName(chapterText, token)))
    .map((e) => e.path);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** The user-turn text sent to the model: bounded bible sections, then the chapter. */
export function buildContinuityInput(
  bibleSections: { path: string; content: string }[],
  chapterTitle: string,
  chapterText: string
): string {
  const bible = bibleSections
    .filter((s) => s.content.trim())
    .map((s) => `## ${s.path}\n${truncate(s.content.trim(), MAX_BIBLE_CHARS)}`)
    .join("\n\n");
  return [
    "# Story bible",
    bible || "(no bible facts on file yet)",
    "",
    `# Chapter: ${chapterTitle}`,
    truncate(chapterText, MAX_CHAPTER_CHARS),
  ].join("\n");
}

/** Case-insensitive substring check, so quoting only needs care, not exact casing. */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Drop any finding whose quotes are not actually in the text they claim to
 * quote. The system prompt insists on verbatim substrings so "Show in text"
 * can always locate the passage, but a model can still paraphrase - this is
 * the backstop so a hallucinated or reworded quote never reaches the author
 * as an unclickable "finding".
 */
export function groundFindings(
  findings: ContinuityFinding[],
  chapterText: string,
  bibleSections: { path: string; content: string }[]
): ContinuityFinding[] {
  const byPath = new Map(bibleSections.map((s) => [s.path, s.content]));
  return findings.filter((f) => {
    if (findMatches(chapterText, f.chapterQuote, { matchCase: false, wholeWord: true }).length === 0) return false;
    const canonContent = byPath.get(f.canonFile);
    return canonContent !== undefined && contains(canonContent, f.canonQuote);
  });
}

function isKnownCanonFile(path: string): boolean {
  return path === "canon.md" || path === "world.md" || path === "timeline.md" || /^characters\/[^/]+\.md$/.test(path);
}

/**
 * "Show in text" searches one line of at most MAX_QUERY_LENGTH characters, so
 * a chapter quote that spans paragraphs keeps its first line, and a long one
 * keeps its opening; either is still a verbatim substring of the chapter.
 */
function searchableQuote(raw: string): string {
  const firstLine = raw.split(/[\r\n]+/).map((l) => l.trim()).find(Boolean) ?? "";
  if (firstLine.length <= MAX_QUERY_LENGTH) return firstLine;
  const cut = firstLine.slice(0, MAX_QUERY_LENGTH + 1);
  const lastBreak = cut.search(/[^\p{L}\p{N}_][\p{L}\p{N}_]*$/u);
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : "").trim();
}

function normalizeFinding(raw: unknown): ContinuityFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const chapterQuote = typeof src.chapterQuote === "string" ? searchableQuote(src.chapterQuote) : "";
  const canonQuote = typeof src.canonQuote === "string" ? src.canonQuote.trim().slice(0, QUOTE_MAX) : "";
  const canonFile = typeof src.canonFile === "string" ? src.canonFile.trim() : "";
  const note = typeof src.note === "string" ? src.note.trim().slice(0, NOTE_MAX) : "";
  if (!chapterQuote || !canonQuote || !canonFile || !isKnownCanonFile(canonFile)) return null;
  return { chapterQuote, canonQuote, canonFile, note };
}

/** Pull a JSON array of findings out of model text, tolerating fences and stray prose. */
export function parseContinuityFindings(raw: string): ContinuityFinding[] {
  const trimmed = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const arr = trimmed.match(/\[[\s\S]*\]/);
    if (arr) {
      try {
        parsed = JSON.parse(arr[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(normalizeFinding)
    .filter((f): f is ContinuityFinding => f !== null)
    .slice(0, FINDINGS_MAX);
}
