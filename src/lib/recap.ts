import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_FAST_MODEL, DRAFTER_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { RECAP_SYSTEM, STUCK_SYSTEM } from "@/lib/prompts";
import { readBibleFile } from "@/lib/bible";
import { visibleChapterWhere } from "@/lib/chapters";
import { chapterPlainText, countWords } from "@/lib/text";
import {
  RECAP_MIN_WORDS,
  fingerprintText,
  parseStuckPrompts,
  type Recap,
  type RecapResponse,
  type StuckResponse,
} from "@/lib/recap-view";

const RECAP_CHAPTERS = 5;
const TAIL_CHARS = 700;
const STUCK_TAIL_CHARS = 2000;
const BIBLE_CHARS = 1500;

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function tail(text: string, chars: number): string {
  return text.length > chars ? `...${text.slice(-chars)}` : text;
}

/**
 * The "Previously on" recap for a manuscript, cached by a fingerprint of the
 * text it is written from. Fail-soft: too little writing, no key, or a model
 * failure all return `{ recap: null }` (a stale cached recap is still served).
 */
export async function getRecap(
  projectId: string,
  user: PublicUser | null
): Promise<RecapResponse> {
  await authorizeOwnedProject(projectId, user);

  const chapters = await prisma.chapter.findMany({
    where: { projectId, ...visibleChapterWhere },
    orderBy: { order: "asc" },
    select: { id: true, title: true, summary: true, content: true, updatedAt: true },
  });

  const plain = chapters.map((c) => ({ ...c, text: chapterPlainText(c.content) }));
  const totalWords = plain.reduce((sum, c) => sum + countWords(c.text), 0);
  if (totalWords < RECAP_MIN_WORDS) return { recap: null };

  // Recent work: the chapters touched last, shown in story order. A chapter's
  // beat summary stands in for its prose when the summarizer has run.
  const recent = plain
    .filter((c) => c.text.trim())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, RECAP_CHAPTERS);
  const recentIds = new Set(recent.map((c) => c.id));
  const source = plain
    .filter((c) => recentIds.has(c.id))
    .map((c) => {
      const body = c.summary.trim() || tail(c.text.trim(), TAIL_CHARS);
      return `## ${c.title}\n${body}`;
    })
    .join("\n\n");

  const fingerprint = fingerprintText(source);
  const cached = await prisma.projectRecap.findUnique({ where: { projectId } });
  const asRecap = (row: { content: string; generatedAt: Date }): Recap => ({
    text: row.content,
    generatedAt: row.generatedAt.toISOString(),
  });
  if (cached && cached.fingerprint === fingerprint) return { recap: asRecap(cached) };
  if (!hasAnthropicKey()) return { recap: cached ? asRecap(cached) : null };

  try {
    const res = await getAnthropic().messages.create({
      model: DRAFTER_FAST_MODEL,
      max_tokens: 350,
      system: RECAP_SYSTEM,
      messages: [{ role: "user", content: source }],
    });
    const content = textOf(res);
    if (!content) return { recap: cached ? asRecap(cached) : null };
    const generatedAt = new Date();
    await prisma.projectRecap.upsert({
      where: { projectId },
      create: { projectId, content, fingerprint, generatedAt },
      update: { content, fingerprint, generatedAt },
    });
    return { recap: { text: content, generatedAt: generatedAt.toISOString() } };
  } catch {
    return { recap: cached ? asRecap(cached) : null };
  }
}

/**
 * A few concrete next-step prompts for an author who is stuck, from the open
 * chapter and the story bible. Not cached: each ask should feel fresh.
 */
export async function getStuckPrompts(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<StuckResponse> {
  await authorizeOwnedProject(projectId, user);
  const src = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const chapterId = typeof src.chapterId === "string" ? src.chapterId : "";
  if (!hasAnthropicKey()) throw new AuthError("The AI editor is not configured.", 503);

  const [project, chapter, questions] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { title: true, genre: true, logline: true, pov: true },
    }),
    chapterId
      ? prisma.chapter.findFirst({
          where: { id: chapterId, projectId },
          select: { title: true, content: true },
        })
      : null,
    prisma.openQuestion.findMany({
      where: { projectId, status: "open" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { question: true },
    }),
  ]);
  if (!project) throw new AuthError("Not found.", 404);

  const parts = [`# ${project.title}`];
  if (project.genre) parts.push(`Genre: ${project.genre}`);
  if (project.logline) parts.push(`Logline: ${project.logline}`);
  if (project.pov) parts.push(`POV: ${project.pov}`);
  for (const name of ["canon.md", "plot.md"]) {
    const text = (await readBibleFile(projectId, name)).trim();
    if (text) parts.push(`\n<<< ${name} >>>\n${text.slice(0, BIBLE_CHARS)}`);
  }
  if (questions.length) {
    parts.push("\n# Open questions", ...questions.map((q) => `- ${q.question}`));
  }
  if (chapter) {
    const text = chapterPlainText(chapter.content).trim();
    parts.push(`\n# Current chapter: ${chapter.title}`);
    parts.push(text ? tail(text, STUCK_TAIL_CHARS) : "(empty so far)");
  }

  let prompts: string[] = [];
  try {
    const res = await getAnthropic().messages.create({
      model: DRAFTER_MODEL,
      max_tokens: 600,
      system: STUCK_SYSTEM,
      messages: [{ role: "user", content: parts.join("\n") }],
    });
    prompts = parseStuckPrompts(textOf(res));
  } catch {
    throw new AuthError("Could not get ideas right now. Try again.", 502);
  }
  if (!prompts.length) throw new AuthError("Could not get ideas right now. Try again.", 502);
  return { prompts };
}
