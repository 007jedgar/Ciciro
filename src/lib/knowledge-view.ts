// Pure helpers for the who-knows-what ledger. The KnowledgeFact table is the
// source of truth; the block between the markers below is a mirror written
// into characters/<slug>.md so read_bible and a person opening the file see
// the same lines. No database access here.

export const KNOWS_START = "<!-- knows:start -->";
export const KNOWS_END = "<!-- knows:end -->";

/** How many facts the always-on editor context will list, and how long that list may run. */
export const WHO_KNOWS_MAX_FACTS = 12;
export const WHO_KNOWS_MAX_CHARS = 900;
export const KNOWLEDGE_FACT_MAX = 500;

export type KnowsStance = "knows" | "believes";

export type MirrorFact = {
  stance: KnowsStance;
  fact: string;
};

const CHARACTER_PATH = /^characters\/[^/]+\.md$/;

export function isCharacterPath(path: string): boolean {
  return CHARACTER_PATH.test(path);
}

export function characterLabel(path: string): string {
  return path.replace(/^characters\//, "").replace(/\.md$/, "").replace(/-/g, " ");
}

export function parseStance(value: unknown): KnowsStance | null {
  return value === "knows" || value === "believes" ? value : null;
}

/** The mirror block, or "" when there is nothing active to show. */
export function renderKnowsBlock(facts: MirrorFact[]): string {
  if (!facts.length) return "";
  const lines = facts.map((f) => `- ${f.stance}: ${f.fact.trim()}`);
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

/** Lines appended to a character file when it is sent to the continuity check. */
export function knowledgeSectionAddon(facts: MirrorFact[]): string {
  if (!facts.length) return "";
  const lines = facts.map((f) => `- ${f.stance}: ${f.fact.trim()}`);
  return `\n\n## Who knows what\n${lines.join("\n")}\n`;
}

export function formatWhoKnowsList(
  items: { label: string; stance: string; fact: string }[],
  maxFacts = WHO_KNOWS_MAX_FACTS,
  maxChars = WHO_KNOWS_MAX_CHARS
): string {
  const lines: string[] = [];
  let used = 0;
  for (const item of items) {
    if (lines.length >= maxFacts) break;
    const fact = item.fact.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!fact) continue;
    const line = `- ${item.label} ${item.stance}: ${fact}`;
    if (lines.length > 0 && used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (!lines.length) return "";
  return ["# WHO KNOWS WHAT (characters named in the open chapter)", ...lines].join("\n");
}
