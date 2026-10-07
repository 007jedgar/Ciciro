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
  type KnowsStance,
  type MirrorFact,
} from "@/lib/knowledge-view";

// The who-knows-what ledger. Facts are rows so they can be queried by
// character and chapter and superseded when they change. On every accept or
// retire, only the mirror block in that character file is rewritten.

export type KnowledgeFactView = {
  id: string;
  characterPath: string;
  fact: string;
  stance: KnowsStance;
  chapterId: string | null;
  chapter: { id: string; title: string; order: number } | null;
  sourceQuote: string;
  status: string;
};

const factSelect = {
  id: true,
  characterPath: true,
  fact: true,
  stance: true,
  chapterId: true,
  sourceQuote: true,
  status: true,
  chapter: { select: { id: true, title: true, order: true } },
} as const;

function asView(row: {
  id: string;
  characterPath: string;
  fact: string;
  stance: string;
  chapterId: string | null;
  chapter: { id: string; title: string; order: number } | null;
  sourceQuote: string;
  status: string;
}): KnowledgeFactView {
  const stance = parseStance(row.stance);
  if (!stance) throw new AuthError("That fact has no stance.", 500);
  return { ...row, stance };
}

/** Active facts for the named character files, oldest first. No auth: callers already scoped the project. */
export async function activeFactsForPaths(
  projectId: string,
  paths: string[]
): Promise<{ characterPath: string; stance: string; fact: string }[]> {
  if (!paths.length) return [];
  return prisma.knowledgeFact.findMany({
    where: { projectId, status: "active", characterPath: { in: paths } },
    orderBy: [{ characterPath: "asc" }, { createdAt: "asc" }],
    select: { characterPath: true, stance: true, fact: true },
  });
}

/** Capped always-on list for characters named in the open chapter. */
export async function whoKnowsWhatBlock(projectId: string, paths: string[]): Promise<string> {
  const facts = await activeFactsForPaths(projectId, paths);
  return formatWhoKnowsList(
    facts.map((f) => ({ label: characterLabel(f.characterPath), stance: f.stance, fact: f.fact }))
  );
}

async function refreshMirror(projectId: string, characterPath: string): Promise<void> {
  const [file, facts] = await Promise.all([
    getBibleFile(projectId, characterPath),
    prisma.knowledgeFact.findMany({
      where: { projectId, characterPath, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { stance: true, fact: true },
    }),
  ]);
  if (!file) return;
  const mirror: MirrorFact[] = [];
  for (const fact of facts) {
    const stance = parseStance(fact.stance);
    if (stance) mirror.push({ stance, fact: fact.fact });
  }
  const next = withKnowsBlock(file.content, mirror);
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

/**
 * The ledger for the Knowledge screen. `characterPath` omitted lists every
 * character (grouped by the caller); `includeRetired` adds superseded rows
 * alongside active ones so a screen can show the ledger's history.
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

export async function addKnowledgeFact(
  projectId: string,
  user: PublicUser | null,
  input: {
    characterPath: string;
    fact: string;
    stance: unknown;
    chapterId?: string | null;
    sourceQuote?: string;
  }
): Promise<KnowledgeFactView> {
  await authorizeOwnedProject(projectId, user);
  const characterPath = input.characterPath.trim();
  await requireCharacterFile(projectId, characterPath);
  const stance = parseStance(input.stance);
  if (!stance) throw new AuthError("Stance must be knows or believes.", 400);
  const fact = input.fact.trim().slice(0, KNOWLEDGE_FACT_MAX);
  if (!fact) throw new AuthError("Write the fact first.", 400);
  let chapterId: string | null = null;
  if (input.chapterId) {
    const chapter = await prisma.chapter.findFirst({
      where: { id: input.chapterId, projectId },
      select: { id: true },
    });
    if (!chapter) throw new AuthError("Chapter not found.", 404);
    chapterId = chapter.id;
  }
  const created = await prisma.knowledgeFact.create({
    data: {
      projectId,
      characterPath,
      fact,
      stance,
      chapterId,
      sourceQuote: (input.sourceQuote ?? "").trim().slice(0, 400),
      status: "active",
    },
    select: factSelect,
  });
  await refreshMirror(projectId, characterPath);
  return asView(created);
}

export async function retireKnowledgeFact(
  projectId: string,
  user: PublicUser | null,
  factId: string
): Promise<void> {
  await authorizeOwnedProject(projectId, user);
  const fact = await prisma.knowledgeFact.findFirst({
    where: { id: factId, projectId },
    select: { id: true, characterPath: true },
  });
  if (!fact) throw new AuthError("Fact not found.", 404);
  await prisma.knowledgeFact.update({
    where: { id: fact.id },
    data: { status: "superseded" },
  });
  await refreshMirror(projectId, fact.characterPath);
}

/** Edit a fact's text, stance, and/or chapter in place. The character it belongs to never changes. */
export async function updateKnowledgeFact(
  projectId: string,
  user: PublicUser | null,
  factId: string,
  input: { fact?: unknown; stance?: unknown; chapterId?: unknown }
): Promise<KnowledgeFactView> {
  await authorizeOwnedProject(projectId, user);
  const existing = await prisma.knowledgeFact.findFirst({
    where: { id: factId, projectId },
    select: { id: true, characterPath: true },
  });
  if (!existing) throw new AuthError("Fact not found.", 404);

  const data: { fact?: string; stance?: KnowsStance; chapterId?: string | null } = {};

  if (input.fact !== undefined) {
    if (typeof input.fact !== "string") throw new AuthError("Write the fact first.", 400);
    const fact = input.fact.trim().slice(0, KNOWLEDGE_FACT_MAX);
    if (!fact) throw new AuthError("Write the fact first.", 400);
    data.fact = fact;
  }
  if (input.stance !== undefined) {
    const stance = parseStance(input.stance);
    if (!stance) throw new AuthError("Stance must be knows or believes.", 400);
    data.stance = stance;
  }
  if (input.chapterId !== undefined) {
    if (input.chapterId !== null && typeof input.chapterId !== "string") {
      throw new AuthError("Chapter not found.", 404);
    }
    if (input.chapterId) {
      const chapter = await prisma.chapter.findFirst({
        where: { id: input.chapterId, projectId },
        select: { id: true },
      });
      if (!chapter) throw new AuthError("Chapter not found.", 404);
      data.chapterId = chapter.id;
    } else {
      data.chapterId = null;
    }
  }

  const updated = await prisma.knowledgeFact.update({
    where: { id: existing.id },
    data,
    select: factSelect,
  });
  await refreshMirror(projectId, existing.characterPath);
  return asView(updated);
}
