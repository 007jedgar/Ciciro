// Pure helpers for the chapter-close review: parse the drafter's JSON, drop
// proposals whose chapter quote is not actually in the chapter, and fingerprint
// a dismissal so the next run can skip it. No database or network access.

import { findMatches, MAX_QUERY_LENGTH } from "@/lib/manuscript-search";
import { isCharacterPath, parseStance, type KnowsStance } from "@/lib/knowledge-view";

export const PROPOSAL_KINDS = ["canon", "timeline", "plot", "knowledge"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export type StateProposalDraft = {
  kind: ProposalKind;
  chapterQuote: string;
  text: string;
  note: string;
  stance?: KnowsStance;
  characterPath?: string;
};

export const PROPOSAL_TEXT_MAX = 500;
const NOTE_MAX = 300;
const PROPOSALS_MAX = 16;

export function normalizeProposalText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** chapterId + kind + normalized text. Dismissals are matched on this. */
export function proposalFingerprint(chapterId: string, kind: string, text: string): string {
  return `${chapterId}\n${kind}\n${normalizeProposalText(text)}`;
}

function escapeFence(raw: string): string {
  return raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
}

export function parseJsonReply(raw: string): unknown {
  const trimmed = escapeFence(raw);
  try {
    return JSON.parse(trimmed);
  } catch {
    const arr = trimmed.match(/\[[\s\S]*\]/);
    if (arr) {
      try {
        return JSON.parse(arr[0]);
      } catch {
        return null;
      }
    }
    const obj = trimmed.match(/\{[\s\S]*\}/);
    if (obj) {
      try {
        return JSON.parse(obj[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * "Show in text" searches one line of at most MAX_QUERY_LENGTH characters.
 * Same first-line trim the continuity check uses, so a quote stays a verbatim
 * substring of the chapter.
 */
function searchableQuote(raw: string): string {
  const firstLine = raw.split(/[\r\n]+/).map((l) => l.trim()).find(Boolean) ?? "";
  if (firstLine.length <= MAX_QUERY_LENGTH) return firstLine;
  const cut = firstLine.slice(0, MAX_QUERY_LENGTH + 1);
  const lastBreak = cut.search(/[^\p{L}\p{N}_][\p{L}\p{N}_]*$/u);
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : "").trim();
}

function normalizeProposal(raw: unknown): StateProposalDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const kind = src.kind;
  if (kind !== "canon" && kind !== "timeline" && kind !== "plot" && kind !== "knowledge") return null;
  const chapterQuote = typeof src.chapterQuote === "string" ? searchableQuote(src.chapterQuote) : "";
  const text = typeof src.text === "string" ? src.text.trim().replace(/\s+/g, " ").slice(0, PROPOSAL_TEXT_MAX) : "";
  const note = typeof src.note === "string" ? src.note.trim().slice(0, NOTE_MAX) : "";
  if (!chapterQuote || !text) return null;
  if (kind === "knowledge") {
    const stance = parseStance(src.stance);
    const characterPath = typeof src.characterPath === "string" ? src.characterPath.trim() : "";
    if (!stance || !isCharacterPath(characterPath)) return null;
    return { kind, chapterQuote, text, note, stance, characterPath };
  }
  return { kind, chapterQuote, text, note };
}

/** Pull proposals out of model text. A cut-off or non-JSON reply yields nothing. */
export function parseStateProposals(raw: string): StateProposalDraft[] {
  const parsed = parseJsonReply(raw);
  if (!Array.isArray(parsed)) return [];
  const out: StateProposalDraft[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const proposal = normalizeProposal(item);
    if (!proposal) continue;
    const key = `${proposal.kind}\n${normalizeProposalText(proposal.text)}\n${proposal.characterPath ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(proposal);
    if (out.length >= PROPOSALS_MAX) break;
  }
  return out;
}

/**
 * Drop proposals whose chapterQuote is not a verbatim substring of the chapter,
 * and knowledge proposals whose character file was not part of this run.
 * Same quote check as the continuity check.
 */
export function groundStateProposals(
  proposals: StateProposalDraft[],
  chapterText: string,
  characterPaths: readonly string[]
): StateProposalDraft[] {
  const allowed = new Set(characterPaths);
  return proposals.filter((proposal) => {
    if (findMatches(chapterText, proposal.chapterQuote, { matchCase: false, wholeWord: true }).length === 0) {
      return false;
    }
    if (proposal.kind === "knowledge") {
      return proposal.characterPath !== undefined && allowed.has(proposal.characterPath);
    }
    return true;
  });
}

export function withoutDismissed(
  proposals: StateProposalDraft[],
  chapterId: string,
  fingerprints: ReadonlySet<string>
): StateProposalDraft[] {
  return proposals.filter(
    (proposal) => !fingerprints.has(proposalFingerprint(chapterId, proposal.kind, proposal.text))
  );
}

const CHAPTER_MAX = 20000;
const BIBLE_MAX = 6000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** The user-turn text: canon, plot, timeline, named character files, then the chapter. */
export function buildStateReviewInput(
  bibleSections: { path: string; content: string }[],
  chapterTitle: string,
  chapterText: string
): string {
  const bible = bibleSections
    .filter((s) => s.content.trim())
    .map((s) => `## ${s.path}\n${truncate(s.content.trim(), BIBLE_MAX)}`)
    .join("\n\n");
  return [
    "# Story bible",
    bible || "(no bible facts on file yet)",
    "",
    `# Chapter: ${chapterTitle}`,
    truncate(chapterText, CHAPTER_MAX),
  ].join("\n");
}
