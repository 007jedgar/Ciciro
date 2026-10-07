import type Anthropic from "@anthropic-ai/sdk";
import { prisma, waitUntilRequest } from "@/lib/db";
import { listBible } from "@/lib/bible";
import { AuthError } from "@/lib/auth/session";
import { captureServerEvent } from "@/lib/analytics-server";
import {
  addKnowledgeFactUnchecked,
  deleteKnowledgeFactUnchecked,
  factsAsOfChapter,
  factsBeforeStory,
  retireKnowledgeFactUnchecked,
  updateKnowledgeFactUnchecked,
  type KnowledgeFactPatch,
  type KnowledgeFactView,
} from "@/lib/knowledge";
import { characterLabel, isCharacterPath, stancePhrase } from "@/lib/knowledge-view";
import { KNOWLEDGE_STANCES, parseKnowledgeStance, topicKey } from "@/lib/knowledge-ledger";
import type { ClientUiEvent } from "@/lib/types";

// The chat's way into the who-knows-what ledger. The author asks Ciciro to
// record what a character knows; Ciciro does, against the chapter the author
// has open unless they name another, and says exactly what it wrote. These are
// story-bible writes, not manuscript writes, so like append_canon and
// update_bible they stay available on a Chat only turn (see edit-mode.ts).
//
// They write directly, with no proposal step, because the author asserted the
// fact: the tool descriptions and the editor prompt hold Ciciro to what the
// author said, and the character is matched against existing character files
// rather than guessed.

export type KnowledgeToolResult = {
  status: string;
  content: string;
  ui?: ClientUiEvent;
  mutationCount?: number;
};

export const KNOWLEDGE_TOOL_NAMES = ["record_knowledge", "read_knowledge", "revise_knowledge"] as const;

const STANCE_DOC =
  "knows (true, and they are sure), suspects (they lean toward it but are not sure), believes_wrong (they are sure of something that is false), unaware (they do not know it yet)";

const CHAPTER_PROPS = {
  chapterNumber: {
    type: "integer",
    description:
      "1-based chapter number, only when the author names a chapter. Omitted means the chapter marked OPEN.",
  },
  beforeStory: {
    type: "boolean",
    description: "True when the author says this holds before the story opens (before chapter 1).",
  },
} as const;

export const KNOWLEDGE_TOOLS: Anthropic.Tool[] = [
  {
    name: "record_knowledge",
    description:
      "Record in the who-knows-what ledger what a character knows, suspects, wrongly believes, or does not know, as of a chapter. Use only when the author explicitly asks you to record it, and record only what they stated: never infer a fact, a stance, or which character. It applies from the author's open chapter unless they name another. The result states exactly what was recorded; tell the author that (character, stance, fact, chapter) and offer to change or remove it.",
    input_schema: {
      type: "object",
      properties: {
        character: {
          type: "string",
          description: "The character as the author named them, or their characters/<name>.md path.",
        },
        stance: { type: "string", enum: [...KNOWLEDGE_STANCES], description: STANCE_DOC },
        fact: {
          type: "string",
          description: "What the character knows, suspects, wrongly believes, or does not know: one plain line in the author's words, e.g. \"Suzy has the pen\".",
        },
        ...CHAPTER_PROPS,
        topic: {
          type: "string",
          description:
            "Optional short label shared with other characters' facts on the same question, e.g. \"who has the pen\". Reuse a topic read_knowledge lists when it fits; omit when unsure.",
        },
        replacesFactId: {
          type: "string",
          description:
            "Optional id of this character's earlier fact (from read_knowledge) that this one takes over from at this chapter, when the author says their view changes here. The earlier fact stops holding from this chapter on.",
        },
      },
      required: ["character", "stance", "fact"],
    },
  },
  {
    name: "read_knowledge",
    description:
      "Read the who-knows-what ledger as of a chapter: what each character knows, suspects, wrongly believes, or does not know by the end of it, with fact ids and topics. Defaults to the author's open chapter, so \"what does Joe know at this point\" needs no chapter. Answer only from what this returns; an empty ledger means nothing is recorded, not that the character knows nothing.",
    input_schema: {
      type: "object",
      properties: {
        character: {
          type: "string",
          description: "Optional: one character's name or characters/<name>.md path. Omitted lists everyone.",
        },
        ...CHAPTER_PROPS,
      },
    },
  },
  {
    name: "revise_knowledge",
    description:
      "Change a who-knows-what fact the author asks you to change, by id (from record_knowledge or read_knowledge). Edit its fact, stance, chapter, or topic; retire it from a chapter on when the author says it stops being true there (retire: true, from the open chapter unless they name one); or remove it outright when they say it was recorded by mistake (remove: true). Tell the author exactly what changed.",
    input_schema: {
      type: "object",
      properties: {
        factId: { type: "string", description: "The fact's id" },
        fact: { type: "string", description: "New wording, in the author's words" },
        stance: { type: "string", enum: [...KNOWLEDGE_STANCES], description: STANCE_DOC },
        ...CHAPTER_PROPS,
        topic: { type: "string", description: "New topic; an empty string clears it" },
        retire: {
          type: "boolean",
          description:
            "Stop the fact holding from the chapter given (or the open chapter) on. It stays true before that chapter.",
        },
        remove: {
          type: "boolean",
          description: "Delete the fact entirely. Only when the author says it was recorded by mistake.",
        },
      },
      required: ["factId"],
    },
  },
];

type ToolCtx = { projectId: string; activeChapterId?: string | null };

type VisibleChapter = { id: string; title: string; order: number };

async function visibleChapters(projectId: string): Promise<VisibleChapter[]> {
  return prisma.chapter.findMany({
    where: { projectId, archivedAt: null },
    orderBy: { order: "asc" },
    select: { id: true, title: true, order: true },
  });
}

function chapterName(chapters: VisibleChapter[], chapterId: string | null | undefined): string {
  if (!chapterId) return "before the story opens";
  const index = chapters.findIndex((c) => c.id === chapterId);
  if (index === -1) return "an archived chapter";
  return `chapter ${index + 1} ("${chapters[index].title}")`;
}

type ChapterChoice = { chapterId: string | null } | { error: string };

/**
 * Which chapter a call means: the one the author named, before the story, or
 * the open chapter. With none of those and chapters to choose from, Ciciro
 * has to ask; it never picks one for the author.
 */
function chooseChapter(
  input: Record<string, unknown>,
  chapters: VisibleChapter[],
  ctx: ToolCtx
): ChapterChoice {
  if (input.chapterNumber !== undefined && input.chapterNumber !== null) {
    const n = Number(input.chapterNumber);
    const chapter = Number.isInteger(n) ? chapters[n - 1] : undefined;
    if (!chapter) return { error: `There is no chapter ${input.chapterNumber}. Chapters run 1 to ${chapters.length}.` };
    return { chapterId: chapter.id };
  }
  if (input.beforeStory === true) return { chapterId: null };
  const open = chapters.find((c) => c.id === ctx.activeChapterId);
  if (open) return { chapterId: open.id };
  if (!chapters.length) return { chapterId: null };
  return {
    error:
      "No chapter is open, so it is not clear which chapter this applies from. Ask the author which chapter (or whether it holds before the story opens), then call again with chapterNumber or beforeStory.",
  };
}

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^characters\//, "")
    .replace(/\.md$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type CharacterMatch = { path: string } | { error: string };

/**
 * Match the name the author used against existing character files: a file
 * path as given, or the one file whose name shares all its words with it
 * ("Joe" and characters/joe-marsh.md). Two candidates ("Joe" with joe.md and
 * joe-black.md) or none is a question for the author, never a guess.
 */
export async function resolveCharacter(projectId: string, raw: unknown): Promise<CharacterMatch> {
  const name = typeof raw === "string" ? raw.trim() : "";
  const paths = (await listBible(projectId)).map((e) => e.path).filter(isCharacterPath);
  const listing = paths.length
    ? `Character files: ${paths.map((p) => `${characterLabel(p)} (${p})`).join(", ")}.`
    : "There are no character files yet.";
  if (!name) return { error: `Not recorded: no character was named. ${listing} Ask the author who this is about.` };
  if (paths.includes(name)) return { path: name };
  const wantedWords = normalizeName(name).split(" ").filter(Boolean);
  const wordsOf = (p: string) => normalizeName(p).split(" ").filter(Boolean);
  // Files whose name holds every word the author used ("Joe" -> joe, joe-black);
  // failing that, files whose every word the author used ("Joe Marsh" -> joe).
  const containing = paths.filter((p) => wantedWords.every((w) => wordsOf(p).includes(w)));
  const loose = containing.length
    ? containing
    : paths.filter((p) => wordsOf(p).length > 0 && wordsOf(p).every((w) => wantedWords.includes(w)));
  if (loose.length === 1) return { path: loose[0] };
  if (loose.length > 1) {
    return {
      error: `Not recorded: "${name}" could be ${loose.map((p) => `${characterLabel(p)} (${p})`).join(" or ")}. Ask the author which character they mean, then pass that file's path as character.`,
    };
  }
  return {
    error: `Not recorded: no character file matches "${name}". ${listing} Ask the author which character they mean, or whether to create a character file for them first.`,
  };
}

function describeFact(fact: KnowledgeFactView, chapters: VisibleChapter[]): string {
  const topic = fact.topic ? `; topic: ${fact.topic}` : "";
  return `${characterLabel(fact.characterPath)} ${stancePhrase(fact.stance)} "${fact.fact}", from ${chapterName(chapters, fact.chapterId)}${topic} (id ${fact.id})`;
}

function changed(characterPath: string): ClientUiEvent {
  return { type: "knowledge_changed", characterPath };
}

function failure(error: unknown, status: string): KnowledgeToolResult {
  if (error instanceof AuthError) return { status, content: `Not done: ${error.message}` };
  throw error;
}

/** Count a fact the author had Ciciro record, for the project's owner. Never throws. */
function trackAddedViaChat(projectId: string): void {
  waitUntilRequest(
    prisma.project
      .findUnique({ where: { id: projectId }, select: { userId: true } })
      .then((project) =>
        project?.userId ? captureServerEvent(project.userId, "knowledge_fact_added_via_chat", {}) : undefined
      )
      .catch((error) => console.error("[analytics] knowledge_fact_added_via_chat failed", error))
  );
}

async function recordKnowledge(input: Record<string, unknown>, ctx: ToolCtx): Promise<KnowledgeToolResult> {
  const status = "recording who knows what";
  const stance = parseKnowledgeStance(input.stance);
  if (!stance) {
    return { status, content: `Not recorded: stance must be one of ${KNOWLEDGE_STANCES.join(", ")}.` };
  }
  const fact = typeof input.fact === "string" ? input.fact.trim() : "";
  if (!fact) return { status, content: "Not recorded: the fact is empty. Ask the author what the character knows." };
  const character = await resolveCharacter(ctx.projectId, input.character);
  if ("error" in character) return { status, content: character.error };
  const chapters = await visibleChapters(ctx.projectId);
  const chapter = chooseChapter(input, chapters, ctx);
  if ("error" in chapter) return { status, content: `Not recorded: ${chapter.error}` };
  try {
    const row = await addKnowledgeFactUnchecked(ctx.projectId, {
      characterPath: character.path,
      fact,
      stance,
      chapterId: chapter.chapterId,
      topic: input.topic,
      replacesFactId: typeof input.replacesFactId === "string" && input.replacesFactId ? input.replacesFactId : undefined,
    });
    trackAddedViaChat(ctx.projectId);
    const replaced =
      typeof input.replacesFactId === "string" && input.replacesFactId
        ? ` It takes over from fact ${input.replacesFactId}, which no longer holds from that chapter on.`
        : "";
    return {
      status,
      content:
        `Recorded in who knows what: ${describeFact(row, chapters)}.${replaced} ` +
        "Tell the author exactly that - character, stance, fact, and chapter - and offer to change or remove it.",
      ui: changed(row.characterPath),
      mutationCount: 1,
    };
  } catch (error) {
    return failure(error, status);
  }
}

async function readKnowledge(input: Record<string, unknown>, ctx: ToolCtx): Promise<KnowledgeToolResult> {
  const status = "reading who knows what";
  let paths: string[] | null = null;
  if (typeof input.character === "string" && input.character.trim()) {
    const character = await resolveCharacter(ctx.projectId, input.character);
    if ("error" in character) return { status, content: character.error.replace(/^Not recorded: /, "") };
    paths = [character.path];
  }
  const chapters = await visibleChapters(ctx.projectId);
  const chapter = chooseChapter(input, chapters, ctx);
  const named = input.chapterNumber !== undefined || input.beforeStory === true;
  if ("error" in chapter && named) return { status, content: chapter.error };

  let header: string;
  let facts: KnowledgeFactView[];
  if ("error" in chapter) {
    facts = (await factsAsOfChapter(ctx.projectId, paths, null)).facts;
    header = "Who knows what (no chapter is open, so this is the ledger as it stands now)";
  } else if (chapter.chapterId === null) {
    facts = await factsBeforeStory(ctx.projectId, paths);
    header = "Who knows what before the story opens";
  } else {
    facts = (await factsAsOfChapter(ctx.projectId, paths, chapter.chapterId)).facts;
    header = `Who knows what by the end of ${chapterName(chapters, chapter.chapterId)}`;
  }
  const topics = [...new Map(facts.filter((f) => f.topic).map((f) => [topicKey(f.topic), f.topic as string])).values()];
  const lines = facts.map((f) => `- ${describeFact(f, chapters)}`);
  return {
    status,
    content: [
      `${header}${paths ? ` for ${characterLabel(paths[0])}` : ""}:`,
      lines.length ? lines.join("\n") : "(nothing recorded)",
      topics.length ? `Topics in use: ${topics.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function reviseKnowledge(input: Record<string, unknown>, ctx: ToolCtx): Promise<KnowledgeToolResult> {
  const status = "updating who knows what";
  const factId = typeof input.factId === "string" ? input.factId.trim() : "";
  if (!factId) return { status, content: "Not changed: give the fact's id (read_knowledge lists them)." };
  const chapters = await visibleChapters(ctx.projectId);
  try {
    if (input.remove === true) {
      const gone = await deleteKnowledgeFactUnchecked(ctx.projectId, factId);
      return {
        status,
        content: `Removed from who knows what: ${describeFact(gone, chapters)}. Tell the author it is gone.`,
        ui: changed(gone.characterPath),
        mutationCount: 1,
      };
    }
    if (input.retire === true) {
      const chapter = chooseChapter(input, chapters, ctx);
      if ("error" in chapter) return { status, content: `Not changed: ${chapter.error}` };
      const row = await retireKnowledgeFactUnchecked(ctx.projectId, factId, chapter.chapterId);
      const from = chapter.chapterId ? `from ${chapterName(chapters, chapter.chapterId)} on` : "everywhere";
      return {
        status,
        content: `Retired ${from}: ${describeFact(row, chapters)}. It still holds before then. Tell the author exactly that.`,
        ui: changed(row.characterPath),
        mutationCount: 1,
      };
    }
    const patch: KnowledgeFactPatch = {};
    if (typeof input.fact === "string") patch.fact = input.fact;
    if (input.stance !== undefined) patch.stance = input.stance;
    if (typeof input.topic === "string") patch.topic = input.topic;
    if (input.chapterNumber !== undefined || input.beforeStory === true) {
      const chapter = chooseChapter(input, chapters, ctx);
      if ("error" in chapter) return { status, content: `Not changed: ${chapter.error}` };
      patch.chapterId = chapter.chapterId;
    }
    if (!Object.keys(patch).length) {
      return { status, content: "Not changed: say what to change (fact, stance, chapter, topic), or retire or remove it." };
    }
    const row = await updateKnowledgeFactUnchecked(ctx.projectId, factId, patch);
    return {
      status,
      content: `Updated in who knows what: ${describeFact(row, chapters)}. Tell the author exactly what it says now.`,
      ui: changed(row.characterPath),
      mutationCount: 1,
    };
  } catch (error) {
    return failure(error, status);
  }
}

/** Run one of the knowledge tools, or null when `name` is not one of them. */
export async function executeKnowledgeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolCtx
): Promise<KnowledgeToolResult | null> {
  switch (name) {
    case "record_knowledge":
      return recordKnowledge(input, ctx);
    case "read_knowledge":
      return readKnowledge(input, ctx);
    case "revise_knowledge":
      return reviseKnowledge(input, ctx);
    default:
      return null;
  }
}
