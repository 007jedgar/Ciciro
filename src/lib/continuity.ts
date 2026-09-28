import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { CONTINUITY_CHECK_SYSTEM } from "@/lib/prompts";
import { listBible, readBibleFile } from "@/lib/bible";
import { htmlToText } from "@/lib/text";
import { visibleChapterWhere } from "@/lib/chapters";
import {
  buildContinuityInput,
  parseContinuityFindings,
  relevantCharacterPaths,
  type ContinuityCheckResult,
  type ContinuityFinding,
  type ContinuityScope,
} from "@/lib/continuity-view";

// A continuity check extracts the factual claims a chapter makes (names,
// traits, dates, places) and compares them to the story bible, flagging only
// what directly contradicts a bible line. It never edits prose or canon -
// the author decides what, if anything, to fix - and it stays quiet where the
// bible has no ruling, rather than guessing at one.
//
// Token cost is bounded the same way the editor's tiered context is: canon.md,
// world.md and timeline.md are small, singular files sent every time, and
// character files are sent only for the characters this chapter actually
// names (see relevantCharacterPaths). Findings are not persisted; each run is
// a fresh, on-demand check against the bible as it stands right now.

async function relevantBible(
  projectId: string,
  chapterText: string
): Promise<{ path: string; content: string }[]> {
  const [canon, world, timeline, index] = await Promise.all([
    readBibleFile(projectId, "canon.md"),
    readBibleFile(projectId, "world.md"),
    readBibleFile(projectId, "timeline.md"),
    listBible(projectId),
  ]);
  const characterPaths = relevantCharacterPaths(index, chapterText);
  const characterFiles = await Promise.all(
    characterPaths.map(async (path) => ({ path, content: await readBibleFile(projectId, path) }))
  );
  return [
    { path: "canon.md", content: canon },
    { path: "world.md", content: world },
    { path: "timeline.md", content: timeline },
    ...characterFiles,
  ];
}

async function askModel(
  bibleSections: { path: string; content: string }[],
  chapterTitle: string,
  chapterText: string
): Promise<ContinuityFinding[]> {
  const anthropic = getAnthropic();
  const input = buildContinuityInput(bibleSections, chapterTitle, chapterText);
  let res: Anthropic.Message;
  try {
    res = await anthropic.messages.create({
      model: DRAFTER_MODEL,
      max_tokens: 1500,
      system: CONTINUITY_CHECK_SYSTEM,
      messages: [{ role: "user", content: input }],
    });
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 429 || status === 529 || (typeof status === "number" && status >= 500)) {
      throw new AuthError("Ciciro is busy right now. Try the continuity check again in a minute.", 503);
    }
    throw new AuthError("Ciciro couldn't reach its editor. Try the continuity check again.", 502);
  }
  const text = res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  return parseContinuityFindings(text);
}

function parseRequest(body: unknown): { scope: ContinuityScope; chapterId?: string } {
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const scope: ContinuityScope = src.scope === "book" ? "book" : "chapter";
  const chapterId = typeof src.chapterId === "string" && src.chapterId ? src.chapterId : undefined;
  if (scope === "chapter" && !chapterId) {
    throw new AuthError("chapterId is required for a chapter check.", 400);
  }
  return { scope, chapterId };
}

/** Check one chapter, or every chapter, against the story bible. */
export async function runContinuityCheck(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<ContinuityCheckResult> {
  await authorizeOwnedProject(projectId, user);
  if (!hasAnthropicKey()) {
    throw new AuthError("Continuity check needs an ANTHROPIC_API_KEY.", 503);
  }
  const { scope, chapterId } = parseRequest(body);

  const chapters = await prisma.chapter.findMany({
    where: {
      projectId,
      ...visibleChapterWhere,
      ...(scope === "chapter" ? { id: chapterId } : {}),
    },
    orderBy: { order: "asc" },
    select: { id: true, title: true, content: true },
  });
  if (scope === "chapter" && chapters.length === 0) {
    throw new AuthError("Chapter not found.", 404);
  }

  const findings: ContinuityCheckResult["findings"] = [];
  // Sequential, not Promise.all: one call per chapter is already the bound on
  // cost, and a whole-manuscript run should not burst every chapter's request
  // at the model provider at once.
  for (const chapter of chapters) {
    const text = htmlToText(chapter.content).trim();
    if (!text) continue;
    const bible = await relevantBible(projectId, text);
    const chapterFindings = await askModel(bible, chapter.title, text);
    for (const finding of chapterFindings) {
      findings.push({ ...finding, chapterId: chapter.id, chapterTitle: chapter.title });
    }
  }
  return { scope, findings };
}
