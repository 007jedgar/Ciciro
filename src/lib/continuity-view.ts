// Shapes and pure helpers for the continuity check: which bible files are
// relevant to a chapter, and how the model's JSON reply is parsed into
// findings. No DB or network access here so the matching and prompt-building
// logic can be unit tested without mocking Anthropic or Prisma; see
// src/lib/continuity.ts for the parts that touch the database and the model.

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
};

export const MAX_BIBLE_CHARS = 6000;
export const MAX_CHAPTER_CHARS = 20000;
const QUOTE_MAX = 400;
const NOTE_MAX = 300;
const FINDINGS_MAX = 20;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Candidate names for a character file: the de-slugged path, and the index summary. */
function nameCandidates(entry: BibleIndexEntry): string[] {
  const slugName = entry.path
    .replace(/^characters\//, "")
    .replace(/\.md$/, "")
    .replace(/-/g, " ")
    .trim();
  const summaryName = entry.summary.split(/[-–,(]/)[0]?.trim() ?? "";
  return [slugName, summaryName].filter((s) => s.length >= 2);
}

/** True when the name's first word (its call name) appears as a whole word in the text. */
function mentionsName(text: string, name: string): boolean {
  const token = name.split(/\s+/).filter(Boolean)[0];
  if (!token) return false;
  return new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(text);
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
    .filter((e) => nameCandidates(e).some((name) => mentionsName(chapterText, name)))
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

function isKnownCanonFile(path: string): boolean {
  return path === "canon.md" || path === "world.md" || path === "timeline.md" || /^characters\/[^/]+\.md$/.test(path);
}

function normalizeFinding(raw: unknown): ContinuityFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const chapterQuote = typeof src.chapterQuote === "string" ? src.chapterQuote.trim().slice(0, QUOTE_MAX) : "";
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
