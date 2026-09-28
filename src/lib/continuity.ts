import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { CONTINUITY_CHECK_SYSTEM } from "@/lib/prompts";
import { listBible, readBibleFile, type BibleEntry } from "@/lib/bible";
import { chapterPlainText } from "@/lib/text";
import { visibleChapterWhere } from "@/lib/chapters";
import {
  buildContinuityInput,
  groundFindings,
  parseContinuityFindings,
  relevantCharacterPaths,
  type ContinuityCheckFinding,
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

const BOOK_CONCURRENCY = 3;
const BOOK_TIME_BUDGET_MS = 240_000;

type BibleSection = { path: string; content: string };

/** canon.md, world.md, timeline.md and the index, read once per run. */
async function loadBible(projectId: string): Promise<{ singular: BibleSection[]; index: BibleEntry[] }> {
  const [canon, world, timeline, index] = await Promise.all([
    readBibleFile(projectId, "canon.md"),
    readBibleFile(projectId, "world.md"),
    readBibleFile(projectId, "timeline.md"),
    listBible(projectId),
  ]);
  return {
    singular: [
      { path: "canon.md", content: canon },
      { path: "world.md", content: world },
      { path: "timeline.md", content: timeline },
    ],
    index,
  };
}

async function relevantBible(
  projectId: string,
  bible: { singular: BibleSection[]; index: BibleEntry[] },
  characterCache: Map<string, Promise<string>>,
  chapterText: string
): Promise<BibleSection[]> {
  const characterPaths = relevantCharacterPaths(bible.index, chapterText);
  const characterFiles = await Promise.all(
    characterPaths.map(async (path) => {
      let content = characterCache.get(path);
      if (!content) {
        content = readBibleFile(projectId, path);
        characterCache.set(path, content);
      }
      return { path, content: await content };
    })
  );
  return [...bible.singular, ...characterFiles];
}

async function askModel(
  bibleSections: BibleSection[],
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

  const bible = await loadBible(projectId);
  const characterCache = new Map<string, Promise<string>>();
  const deadline = Date.now() + BOOK_TIME_BUDGET_MS;
  const perChapter: { findings: ContinuityCheckFinding[]; status: "pending" | "empty" | "checked"; error?: unknown }[] =
    chapters.map(() => ({ findings: [], status: "pending" }));

  async function checkChapter(i: number): Promise<void> {
    const chapter = chapters[i];
    const text = chapterPlainText(chapter.content).trim();
    if (!text) {
      perChapter[i].status = "empty";
      return;
    }
    const sections = await relevantBible(projectId, bible, characterCache, text);
    const grounded = groundFindings(await askModel(sections, chapter.title, text), text, sections);
    perChapter[i].findings = grounded.map((f) => ({ ...f, chapterId: chapter.id, chapterTitle: chapter.title }));
    perChapter[i].status = "checked";
  }

  // A small worker pool, not Promise.all: one call per chapter is already the
  // bound on cost, and a whole-manuscript run should not burst every
  // chapter's request at the model provider at once. Chapters not started
  // before the time budget runs out, or whose call fails, are reported as
  // unchecked so the findings already gathered still reach the author.
  let next = 0;
  async function worker(): Promise<void> {
    while (next < chapters.length && Date.now() < deadline) {
      const i = next++;
      try {
        await checkChapter(i);
      } catch (error) {
        if (scope === "chapter") throw error;
        perChapter[i].error = error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BOOK_CONCURRENCY, chapters.length) }, worker));

  const firstError = perChapter.find((c) => c.error !== undefined)?.error;
  if (firstError !== undefined && !perChapter.some((c) => c.status === "checked")) throw firstError;

  return {
    scope,
    findings: perChapter.flatMap((c) => c.findings),
    unchecked: chapters
      .filter((_, i) => perChapter[i].status === "pending")
      .map((chapter) => ({ chapterId: chapter.id, chapterTitle: chapter.title })),
  };
}
