/**
 * The who-knows-what ledger's story-order rules, shared by the server, the
 * desk, and the phone. The Expo app cannot import from the Next app, so
 * apps/mobile/lib/knowledge-ledger.ts is a byte-for-byte copy;
 * test/knowledge-ledger-parity fails when they drift. No imports, no I/O.
 *
 * A fact is anchored to the chapter where it becomes true (none: before the
 * story opens) and, once retired, to the chapter where it stopped being true.
 * "As of chapter N" means the state by the end of chapter N. Chapter order is
 * renumbered on every reorder, so callers pass the order they just read, on
 * both ends, never one they cached.
 */

export const KNOWLEDGE_STANCES = ["knows", "suspects", "believes_wrong", "unaware"] as const;

export type KnowledgeStance = (typeof KNOWLEDGE_STANCES)[number];

/**
 * A stance from the wire or the database. "believes", the ledger's first
 * vocabulary, reads as "suspects": whether a belief was wrong is the author's
 * call, never a mechanical one.
 */
export function parseKnowledgeStance(value: unknown): KnowledgeStance | null {
  if (value === "believes") return "suspects";
  return KNOWLEDGE_STANCES.includes(value as KnowledgeStance) ? (value as KnowledgeStance) : null;
}

/** How a stance reads in a sentence about a character: "Joe wrongly believes: ...". English, for prompts and the mirror block. */
export const STANCE_PHRASES: Record<KnowledgeStance, string> = {
  knows: "knows",
  suspects: "suspects",
  believes_wrong: "wrongly believes",
  unaware: "does not know",
};

/** The position of "before the story opens": every chapter order is 0 or more. */
export const BEFORE_STORY_ORDER = -1;

export type LedgerChapter = { id: string; title: string; order: number };

export type LedgerFact = {
  id: string;
  characterPath: string;
  fact: string;
  stance: KnowledgeStance;
  topic: string | null;
  status: string;
  chapter: LedgerChapter | null;
  supersededAtChapter: LedgerChapter | null;
};

type AsOfFact = Pick<LedgerFact, "status" | "chapter" | "supersededAtChapter">;

/** Where a fact becomes true: its chapter's order, or before the story opens. */
export function anchorOrder(fact: Pick<LedgerFact, "chapter">): number {
  return fact.chapter ? fact.chapter.order : BEFORE_STORY_ORDER;
}

/**
 * Whether a fact holds by the end of the chapter at `asOfOrder`. An active
 * fact holds from its anchor on. A retired fact holds from its anchor until
 * the chapter it was retired at; one retired with no chapter (or whose
 * chapter is gone) holds nowhere, as retiring did before chapters mattered.
 */
export function inEffectAsOf(fact: AsOfFact, asOfOrder: number): boolean {
  if (anchorOrder(fact) > asOfOrder) return false;
  if (fact.status === "active") return true;
  return fact.supersededAtChapter !== null && fact.supersededAtChapter.order > asOfOrder;
}

export const TOPIC_MAX = 80;

/** Topics group facts across characters. Matching ignores case and spacing. */
export function topicKey(topic: string | null | undefined): string {
  return (topic ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanTopic(topic: unknown): string | null {
  if (typeof topic !== "string") return null;
  const clean = topic.trim().replace(/\s+/g, " ").slice(0, TOPIC_MAX);
  return clean || null;
}


/** Story order, then fact text, so a list never reshuffles between loads. */
export function byStoryOrder<T extends Pick<LedgerFact, "chapter" | "fact">>(a: T, b: T): number {
  const diff = anchorOrder(a) - anchorOrder(b);
  return diff !== 0 ? diff : a.fact.localeCompare(b.fact);
}

export type TimelineState = "in_effect" | "ended" | "later";

export type TimelineRow<T extends LedgerFact = LedgerFact> = {
  fact: T;
  state: TimelineState;
  /** For an ended fact with a topic: what the character held on that topic next. */
  replacedBy: T | null;
};

/**
 * One character's facts in story order, each marked as holding at `asOfOrder`,
 * already ended by then (struck through, with what replaced it when the topic
 * says), or not yet true. Retired facts that never held anywhere are left out.
 */
export function characterTimeline<T extends LedgerFact>(facts: T[], asOfOrder: number): TimelineRow<T>[] {
  const sorted = [...facts].sort(byStoryOrder);
  return sorted
    .filter((fact) => fact.status === "active" || fact.supersededAtChapter !== null)
    .map((fact) => {
      if (anchorOrder(fact) > asOfOrder) return { fact, state: "later" as const, replacedBy: null };
      if (inEffectAsOf(fact, asOfOrder)) return { fact, state: "in_effect" as const, replacedBy: null };
      return { fact, state: "ended" as const, replacedBy: successorOf(fact, sorted) };
    });
}

function successorOf<T extends LedgerFact>(fact: T, sorted: T[]): T | null {
  const key = topicKey(fact.topic);
  const endedAt = fact.supersededAtChapter?.order;
  if (!key || endedAt === undefined) return null;
  return (
    sorted.find(
      (other) =>
        other.id !== fact.id &&
        other.characterPath === fact.characterPath &&
        topicKey(other.topic) === key &&
        anchorOrder(other) >= endedAt
    ) ?? null
  );
}

export type LedgerGrid<T extends LedgerFact = LedgerFact> = {
  topics: { key: string; label: string }[];
  characters: string[];
  /** `${topicKey}\n${characterPath}` to the fact holding there, the latest-anchored one when several do. */
  cells: Map<string, T>;
};

export function gridCellKey(topic: string, characterPath: string): string {
  return `${topicKey(topic)}\n${characterPath}`;
}

/**
 * Rows are topics, columns are characters, and each cell is that character's
 * stance on the topic by the end of the chapter at `asOfOrder`. Facts with no
 * topic are not in the grid. A topic or character shows as soon as any of its
 * facts exist, so the grid keeps its shape as the scrubber moves.
 */
export function knowledgeGrid<T extends LedgerFact>(facts: T[], asOfOrder: number): LedgerGrid<T> {
  const labels = new Map<string, string>();
  const characters = new Set<string>();
  const cells = new Map<string, T>();
  for (const fact of [...facts].sort(byStoryOrder)) {
    const key = topicKey(fact.topic);
    if (!key) continue;
    if (fact.status !== "active" && fact.supersededAtChapter === null) continue;
    if (!labels.has(key)) labels.set(key, (fact.topic ?? "").trim().replace(/\s+/g, " "));
    characters.add(fact.characterPath);
    if (inEffectAsOf(fact, asOfOrder)) cells.set(`${key}\n${fact.characterPath}`, fact);
  }
  return {
    topics: [...labels.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    characters: [...characters].sort((a, b) => a.localeCompare(b)),
    cells,
  };
}

/**
 * The grid's Reader column: the first line of canon.md that mentions the
 * topic, as the reader's ground truth. Null when canon.md is silent on it.
 */
export function readerNoteFor(topic: string, canon: string): string | null {
  const key = topicKey(topic);
  if (!key) return null;
  for (const raw of canon.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.toLowerCase().replace(/\s+/g, " ").includes(key)) return line;
  }
  return null;
}
