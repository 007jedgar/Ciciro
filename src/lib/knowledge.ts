import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { getBibleFile, writeBibleFile } from "@/lib/bible";
import {
  characterLabel,
  formatWhoKnowsList,
  isCharacterPath,
  KNOWLEDGE_FACT_MAX,
  parseStance,
  withKnowsBlock,
  type MirrorFact,
} from "@/lib/knowledge-view";
import {
  anchorOrder,
  BEFORE_STORY_ORDER,
  byStoryOrder,
  cleanTopic,
  inEffectAsOf,
  type LedgerChapter,
  type LedgerFact,
} from "@/lib/knowledge-ledger";

// The who-knows-what ledger. Facts are rows so they can be queried by
// character and chapter and superseded when they change. On every accept or
// retire, only the mirror block in that character file is rewritten.
//
// The exported functions that take a `user` authorize it. The ones that do not
// (factsAsOfChapter, activeFactsForPaths, and the *Unchecked writers the chat
// tools call) trust that their caller already scoped the project.

export type KnowledgeFactView = LedgerFact & {
  chapterId: string | null;
  supersededAtChapterId: string | null;
  sourceQuote: string;
};

const chapterRef = { select: { id: true, title: true, order: true } } as const;

const factSelect = {
  id: true,
  characterPath: true,
  fact: true,
  stance: true,
  topic: true,
  chapterId: true,
  supersededAtChapterId: true,
  sourceQuote: true,
  status: true,
  chapter: chapterRef,
  supersededAtChapter: chapterRef,
} as const;

type FactRow = Omit<KnowledgeFactView, "stance"> & { stance: string };

function asView(row: FactRow): KnowledgeFactView {
  const stance = parseStance(row.stance);
  if (!stance) throw new AuthError("That fact has no stance.", 500);
  return { ...row, stance };
}

function asViews(rows: FactRow[]): KnowledgeFactView[] {
  const out: KnowledgeFactView[] = [];
  for (const row of rows) {
    const stance = parseStance(row.stance);
    if (stance) out.push({ ...row, stance });
  }
  return out;
}

/** Active facts for the named character files, in story order: the ledger as it stands now. */
export async function activeFactsForPaths(
  projectId: string,
  paths: string[] | null
): Promise<KnowledgeFactView[]> {
  if (paths && !paths.length) return [];
  const rows = await prisma.knowledgeFact.findMany({
    where: { projectId, status: "active", ...(paths ? { characterPath: { in: paths } } : {}) },
    orderBy: [{ characterPath: "asc" }, { createdAt: "asc" }],
    select: factSelect,
  });
  return asViews(rows).sort((a, b) => a.characterPath.localeCompare(b.characterPath) || byStoryOrder(a, b));
}

async function factsInEffect(
  projectId: string,
  paths: string[] | null,
  asOfOrder: number
): Promise<KnowledgeFactView[]> {
  if (paths && !paths.length) return [];
  const rows = await prisma.knowledgeFact.findMany({
    where: {
      projectId,
      ...(paths ? { characterPath: { in: paths } } : {}),
      OR: [{ status: "active" }, { supersededAtChapterId: { not: null } }],
    },
    orderBy: [{ characterPath: "asc" }, { createdAt: "asc" }],
    select: factSelect,
  });
  return asViews(rows)
    .filter((fact) => inEffectAsOf(fact, asOfOrder))
    .sort((a, b) => a.characterPath.localeCompare(b.characterPath) || byStoryOrder(a, b));
}

/**
 * The facts that hold by the end of one chapter, for the named character
 * files (null: every character). Both ends of the comparison are read now:
 * the chapter's own order and each fact's anchor and retirement chapters, so
 * a reorder can never leave a stale answer. With no chapter, or one that is
 * not in this project, this is the ledger as it stands now and `asOf` is null
 * (as it is when no character files are named, where nothing is read).
 */
export async function factsAsOfChapter(
  projectId: string,
  paths: string[] | null,
  chapterId: string | null | undefined
): Promise<{ asOf: LedgerChapter | null; facts: KnowledgeFactView[] }> {
  if (paths && !paths.length) return { asOf: null, facts: [] };
  const asOf = chapterId
    ? await prisma.chapter.findFirst({ where: { id: chapterId, projectId }, select: chapterRef.select })
    : null;
  if (!asOf) return { asOf: null, facts: await activeFactsForPaths(projectId, paths) };
  return { asOf, facts: await factsInEffect(projectId, paths, asOf.order) };
}

/** The facts that hold before the story opens: the state chapter 1 starts from. */
export async function factsBeforeStory(
  projectId: string,
  paths: string[] | null
): Promise<KnowledgeFactView[]> {
  return factsInEffect(projectId, paths, BEFORE_STORY_ORDER);
}

/** Facts grouped by character file, as the continuity check and What changed append them. */
export function mirrorFactsByPath(facts: KnowledgeFactView[]): Map<string, MirrorFact[]> {
  const byPath = new Map<string, MirrorFact[]>();
  for (const fact of facts) {
    const list = byPath.get(fact.characterPath) ?? [];
    list.push({ stance: fact.stance, fact: fact.fact, chapterTitle: fact.chapter?.title ?? null });
    byPath.set(fact.characterPath, list);
  }
  return byPath;
}

/**
 * Capped always-on list for characters named in the open chapter, as of that
 * chapter. `chapterNumber` turns a chapter id into its 1-based number among
 * the chapters the editor sees, so each line says where the fact dates from.
 */
export async function whoKnowsWhatBlock(
  projectId: string,
  paths: string[],
  chapterId: string,
  chapterNumber: (id: string) => number | null
): Promise<string> {
  const { asOf, facts } = await factsAsOfChapter(projectId, paths, chapterId);
  const openNumber = asOf ? chapterNumber(asOf.id) : null;
  const heading = openNumber
    ? `# WHO KNOWS WHAT as of the end of chapter ${openNumber} (characters named in the open chapter; nothing from later chapters)`
    : "# WHO KNOWS WHAT (characters named in the open chapter)";
  return formatWhoKnowsList(
    facts.map((f) => {
      const n = f.chapter ? chapterNumber(f.chapter.id) : null;
      return {
        label: characterLabel(f.characterPath),
        stance: f.stance,
        fact: f.fact,
        since: f.chapter ? (n ? `from ch. ${n}` : undefined) : "before the story",
      };
    }),
    { heading }
  );
}

async function refreshMirror(projectId: string, characterPath: string): Promise<void> {
  const [file, facts] = await Promise.all([
    getBibleFile(projectId, characterPath),
    activeFactsForPaths(projectId, [characterPath]),
  ]);
  if (!file) return;
  const next = withKnowsBlock(file.content, mirrorFactsByPath(facts).get(characterPath) ?? []);
  if (next === file.content) return;
  await writeBibleFile(projectId, characterPath, next, file.revision);
}

async function requireCharacterFile(projectId: string, characterPath: string): Promise<void> {
  if (!isCharacterPath(characterPath)) {
    throw new AuthError("A fact belongs on a character file (characters/<name>.md).", 400);
  }
  const file = await getBibleFile(projectId, characterPath);
  if (!file) throw new AuthError("That character file does not exist yet.", 400);
}

async function requireChapter(projectId: string, chapterId: unknown): Promise<LedgerChapter> {
  if (typeof chapterId !== "string" || !chapterId) throw new AuthError("Chapter not found.", 404);
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, projectId },
    select: chapterRef.select,
  });
  if (!chapter) throw new AuthError("Chapter not found.", 404);
  return chapter;
}

const STANCE_ERROR = "Stance must be knows, suspects, believes_wrong, or unaware.";

/**
 * The ledger for the Knowledge screen. `characterPath` omitted lists every
 * character (grouped by the caller); `includeRetired` adds superseded rows
 * alongside active ones so a screen can show the ledger's history and scrub
 * it chapter by chapter.
 */
export async function listKnowledgeFacts(
  projectId: string,
  user: PublicUser | null,
  options: { characterPath?: string; includeRetired?: boolean } = {}
): Promise<KnowledgeFactView[]> {
  await authorizeOwnedProject(projectId, user);
  const { characterPath, includeRetired } = options;
  if (characterPath && !isCharacterPath(characterPath)) return [];
  const rows = await prisma.knowledgeFact.findMany({
    where: {
      projectId,
      ...(characterPath ? { characterPath } : {}),
      ...(includeRetired ? {} : { status: "active" }),
    },
    orderBy: [{ characterPath: "asc" }, { createdAt: "asc" }],
    select: factSelect,
  });
  return rows.map(asView);
}

export type NewKnowledgeFact = {
  characterPath: string;
  fact: string;
  stance: unknown;
  chapterId?: string | null;
  sourceQuote?: string;
  topic?: unknown;
  /**
   * A fact this one takes over from: it is retired at this fact's chapter,
   * and its topic carries over when this one names none. Same character only.
   */
  replacesFactId?: unknown;
};

/** Add a fact. No auth: the caller already scoped the project. */
export async function addKnowledgeFactUnchecked(
  projectId: string,
  input: NewKnowledgeFact
): Promise<KnowledgeFactView> {
  const characterPath = String(input.characterPath ?? "").trim();
  await requireCharacterFile(projectId, characterPath);
  const stance = parseStance(input.stance);
  if (!stance) throw new AuthError(STANCE_ERROR, 400);
  const fact = String(input.fact ?? "").trim().slice(0, KNOWLEDGE_FACT_MAX);
  if (!fact) throw new AuthError("Write the fact first.", 400);
  const chapter = input.chapterId ? await requireChapter(projectId, input.chapterId) : null;
  let topic = cleanTopic(input.topic);

  let replaces: { id: string } | null = null;
  if (input.replacesFactId !== undefined && input.replacesFactId !== null) {
    if (typeof input.replacesFactId !== "string") throw new AuthError("Fact not found.", 404);
    const old = await prisma.knowledgeFact.findFirst({
      where: { id: input.replacesFactId, projectId },
      select: { id: true, characterPath: true, status: true, topic: true, chapter: chapterRef },
    });
    if (!old) throw new AuthError("Fact not found.", 404);
    if (old.characterPath !== characterPath) {
      throw new AuthError("A fact can only take over from one about the same character.", 400);
    }
    if (old.status !== "active") throw new AuthError("That fact is already retired.", 409);
    if (!chapter) throw new AuthError("Pick the chapter where this changes.", 400);
    if (chapter.order < anchorOrder(old)) {
      throw new AuthError("A fact can only change in or after the chapter it dates from.", 400);
    }
    topic = topic ?? cleanTopic(old.topic);
    replaces = old;
  }

  const create = prisma.knowledgeFact.create({
    data: {
      projectId,
      characterPath,
      fact,
      stance,
      topic,
      chapterId: chapter?.id ?? null,
      sourceQuote: (input.sourceQuote ?? "").trim().slice(0, 400),
      status: "active",
    },
    select: factSelect,
  });
  let created: FactRow;
  if (replaces && chapter) {
    const [, row] = await prisma.$transaction([
      prisma.knowledgeFact.update({
        where: { id: replaces.id },
        data: { status: "superseded", supersededAtChapterId: chapter.id },
      }),
      create,
    ]);
    created = row;
  } else {
    created = await create;
  }
  await refreshMirror(projectId, characterPath);
  return asView(created);
}

export async function addKnowledgeFact(
  projectId: string,
  user: PublicUser | null,
  input: NewKnowledgeFact
): Promise<KnowledgeFactView> {
  await authorizeOwnedProject(projectId, user);
  return addKnowledgeFactUnchecked(projectId, input);
}

/**
 * Retire a fact: it stops being true at `asOfChapterId` (the chapter the
 * author has in view) and keeps holding before it. With no chapter it is
 * retired everywhere. No auth: the caller already scoped the project.
 */
export async function retireKnowledgeFactUnchecked(
  projectId: string,
  factId: string,
  asOfChapterId?: string | null
): Promise<KnowledgeFactView> {
  const fact = await prisma.knowledgeFact.findFirst({
    where: { id: factId, projectId },
    select: { id: true, characterPath: true, chapter: chapterRef },
  });
  if (!fact) throw new AuthError("Fact not found.", 404);
  const at = asOfChapterId ? await requireChapter(projectId, asOfChapterId) : null;
  if (at && at.order < anchorOrder(fact)) {
    throw new AuthError("A fact can only be retired in or after the chapter it dates from.", 400);
  }
  const updated = await prisma.knowledgeFact.update({
    where: { id: fact.id },
    data: { status: "superseded", supersededAtChapterId: at?.id ?? null },
    select: factSelect,
  });
  await refreshMirror(projectId, fact.characterPath);
  return asView(updated);
}

export async function retireKnowledgeFact(
  projectId: string,
  user: PublicUser | null,
  factId: string,
  asOfChapterId?: string | null
): Promise<KnowledgeFactView> {
  await authorizeOwnedProject(projectId, user);
  return retireKnowledgeFactUnchecked(projectId, factId, asOfChapterId);
}

export type KnowledgeFactPatch = {
  fact?: unknown;
  stance?: unknown;
  chapterId?: unknown;
  topic?: unknown;
  /** Only on a retired fact: move the chapter where it stopped being true. */
  supersededAtChapterId?: unknown;
};

/**
 * Edit a fact's text, stance, chapter, and/or topic in place. The character
 * it belongs to never changes. No auth: the caller already scoped the project.
 */
export async function updateKnowledgeFactUnchecked(
  projectId: string,
  factId: string,
  input: KnowledgeFactPatch
): Promise<KnowledgeFactView> {
  const existing = await prisma.knowledgeFact.findFirst({
    where: { id: factId, projectId },
    select: { id: true, characterPath: true, status: true },
  });
  if (!existing) throw new AuthError("Fact not found.", 404);

  const data: {
    fact?: string;
    stance?: string;
    chapterId?: string | null;
    topic?: string | null;
    supersededAtChapterId?: string | null;
  } = {};

  if (input.fact !== undefined) {
    if (typeof input.fact !== "string") throw new AuthError("Write the fact first.", 400);
    const fact = input.fact.trim().slice(0, KNOWLEDGE_FACT_MAX);
    if (!fact) throw new AuthError("Write the fact first.", 400);
    data.fact = fact;
  }
  if (input.stance !== undefined) {
    const stance = parseStance(input.stance);
    if (!stance) throw new AuthError(STANCE_ERROR, 400);
    data.stance = stance;
  }
  if (input.chapterId !== undefined) {
    data.chapterId = input.chapterId === null || input.chapterId === ""
      ? null
      : (await requireChapter(projectId, input.chapterId)).id;
  }
  if (input.topic !== undefined) {
    if (input.topic !== null && typeof input.topic !== "string") {
      throw new AuthError("A topic is a short line of text.", 400);
    }
    data.topic = cleanTopic(input.topic);
  }
  if (input.supersededAtChapterId !== undefined) {
    if (existing.status === "active") {
      throw new AuthError("Only a retired fact has a chapter where it stopped.", 400);
    }
    data.supersededAtChapterId =
      input.supersededAtChapterId === null || input.supersededAtChapterId === ""
        ? null
        : (await requireChapter(projectId, input.supersededAtChapterId)).id;
  }

  const updated = await prisma.knowledgeFact.update({
    where: { id: existing.id },
    data,
    select: factSelect,
  });
  await refreshMirror(projectId, existing.characterPath);
  return asView(updated);
}

export async function updateKnowledgeFact(
  projectId: string,
  user: PublicUser | null,
  factId: string,
  input: KnowledgeFactPatch
): Promise<KnowledgeFactView> {
  await authorizeOwnedProject(projectId, user);
  return updateKnowledgeFactUnchecked(projectId, factId, input);
}

/**
 * Remove a fact outright, for one recorded by mistake (retiring keeps it in
 * the story's history). No auth: the caller already scoped the project.
 */
export async function deleteKnowledgeFactUnchecked(
  projectId: string,
  factId: string
): Promise<KnowledgeFactView> {
  const fact = await prisma.knowledgeFact.findFirst({
    where: { id: factId, projectId },
    select: factSelect,
  });
  if (!fact) throw new AuthError("Fact not found.", 404);
  await prisma.knowledgeFact.delete({ where: { id: fact.id } });
  await refreshMirror(projectId, fact.characterPath);
  return asView(fact);
}

/**
 * Before a chapter is deleted, move the facts that date from it (or stopped
 * there) to the chapter that takes its place in the story: the next live one, or
 * live one before when it was last. Left to the foreign key, they would fall
 * back to "before the story opens" and reach every earlier chapter.
 */
export async function moveKnowledgeOffChapter(projectId: string, chapterId: string): Promise<void> {
  const touched = await prisma.knowledgeFact.findMany({
    where: { projectId, OR: [{ chapterId }, { supersededAtChapterId: chapterId }] },
    select: { characterPath: true },
  });
  if (!touched.length) return;
  const gone = await prisma.chapter.findFirst({ where: { id: chapterId, projectId }, select: { order: true } });
  if (!gone) return;
  const neighbor =
    (await prisma.chapter.findFirst({
      where: { projectId, id: { not: chapterId }, archivedAt: null, order: { gte: gone.order } },
      orderBy: { order: "asc" },
      select: { id: true },
    })) ??
    (await prisma.chapter.findFirst({
      where: { projectId, id: { not: chapterId }, archivedAt: null, order: { lt: gone.order } },
      orderBy: { order: "desc" },
      select: { id: true },
    }));
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.knowledgeFact.updateMany({ where: { projectId, chapterId }, data: { chapterId: neighbor.id } }),
    prisma.knowledgeFact.updateMany({
      where: { projectId, supersededAtChapterId: chapterId },
      data: { supersededAtChapterId: neighbor.id },
    }),
  ]);
  for (const path of new Set(touched.map((row) => row.characterPath))) {
    await refreshMirror(projectId, path);
  }
}
