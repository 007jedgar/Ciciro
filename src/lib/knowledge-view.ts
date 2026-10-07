// Pure helpers for the who-knows-what ledger. The KnowledgeFact table is the
// source of truth; the block between the markers below is a mirror written
// into characters/<slug>.md so read_bible and a person opening the file see
// the same lines. No database access here. Story-order rules (stances, "as of
// chapter N") live in knowledge-ledger.ts, which the phone shares.

import {
  STANCE_PHRASES,
  parseKnowledgeStance,
  type KnowledgeStance,
} from "@/lib/knowledge-ledger";

export const KNOWS_START = "<!-- knows:start -->";
export const KNOWS_END = "<!-- knows:end -->";

/** How many facts the always-on editor context will list, and how long that list may run. */
export const WHO_KNOWS_MAX_FACTS = 12;
export const WHO_KNOWS_MAX_CHARS = 900;
export const KNOWLEDGE_FACT_MAX = 500;

export type KnowsStance = KnowledgeStance;

export type MirrorFact = {
  stance: KnowsStance;
  fact: string;
  /** The chapter the fact becomes true in; null is before the story opens. */
  chapterTitle?: string | null;
};

const CHARACTER_PATH = /^characters\/[^/]+\.md$/;

export function isCharacterPath(path: string): boolean {
  return CHARACTER_PATH.test(path);
}

export function characterLabel(path: string): string {
  return path.replace(/^characters\//, "").replace(/\.md$/, "").replace(/-/g, " ");
}

export const parseStance = parseKnowledgeStance;

/** Short badge labels for the web screens. The phone's live in its locale files. */
export const STANCE_LABELS: Record<KnowsStance, string> = {
  knows: "knows",
  suspects: "suspects",
  believes_wrong: "believes wrongly",
  unaware: "doesn't know",
};

export function stancePhrase(stance: KnowsStance): string {
  return STANCE_PHRASES[stance];
}

function anchorNote(title: string | null | undefined): string {
  return title ? `from "${title.replace(/\s+/g, " ").trim()}"` : "before the story";
}

/** The mirror block, or "" when there is nothing active to show. Lines name the chapter each fact dates from. */
export function renderKnowsBlock(facts: MirrorFact[]): string {
  if (!facts.length) return "";
  const lines = facts.map(
    (f) => `- ${stancePhrase(f.stance)} (${anchorNote(f.chapterTitle)}): ${f.fact.trim()}`
  );
  return [KNOWS_START, "## Who knows what", ...lines, KNOWS_END].join("\n");
}

/**
 * Replace the mirror block, or append one. An empty fact list removes the
 * block and leaves the rest of the file untouched.
 */
export function withKnowsBlock(content: string, facts: MirrorFact[]): string {
  const block = renderKnowsBlock(facts);
  const start = content.indexOf(KNOWS_START);
  const end = content.indexOf(KNOWS_END);
  if (start !== -1 && end > start) {
    const before = content.slice(0, start).trimEnd();
    const after = content.slice(end + KNOWS_END.length).trimStart();
    const parts = [before, block, after].filter((part) => part.length > 0);
    return parts.length ? `${parts.join("\n\n")}\n` : "";
  }
  if (!block) return content;
  const base = content.trimEnd();
  return base ? `${base}\n\n${block}\n` : `${block}\n`;
}

/**
 * Lines appended to a character file when it is sent to the continuity check
 * or What changed: the facts that hold by the end of the chapter being read,
 * so a later chapter's knowledge never reaches an earlier one.
 */
export function knowledgeSectionAddon(facts: MirrorFact[]): string {
  if (!facts.length) return "";
  const lines = facts.map((f) => `- ${stancePhrase(f.stance)}: ${f.fact.trim()}`);
  return `\n\n## Who knows what (as of this chapter)\n${lines.join("\n")}\n`;
}

export function formatWhoKnowsList(
  items: { label: string; stance: string; fact: string; since?: string }[],
  options: { heading?: string; maxFacts?: number; maxChars?: number } = {}
): string {
  const {
    heading = "# WHO KNOWS WHAT (characters named in the open chapter)",
    maxFacts = WHO_KNOWS_MAX_FACTS,
    maxChars = WHO_KNOWS_MAX_CHARS,
  } = options;
  const lines: string[] = [];
  let used = 0;
  for (const item of items) {
    if (lines.length >= maxFacts) break;
    const fact = item.fact.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!fact) continue;
    const stance = parseStance(item.stance);
    const phrase = stance ? stancePhrase(stance) : item.stance;
    const line = `- ${item.label} ${phrase}: ${fact}${item.since ? ` [${item.since}]` : ""}`;
    if (lines.length > 0 && used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return "";
  return [heading, ...lines].join("\n");
}
