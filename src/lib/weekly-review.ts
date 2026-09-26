import type Anthropic from "@anthropic-ai/sdk";
import type { WeeklyReview as WeeklyReviewRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { WEEKLY_REVIEW_SYSTEM } from "@/lib/prompts";
import { readBibleFile } from "@/lib/bible";
import { visibleChapterWhere } from "@/lib/chapters";
import {
  REVIEWS_LIST_MAX,
  REVIEW_DAYS,
  emptyStats,
  normalizeContent,
  parseReviewJson,
  type WeeklyReview,
  type WeeklyReviewContent,
  type WeeklyReviewStats,
} from "@/lib/weekly-review-view";
import {
  WRITING_DAY_RE,
  shiftWritingDayKey,
  writingDayKey,
  writingDayKeysInRange,
} from "@/lib/writing-day";

// A weekly review is one row per generation: the numbers (from writing-day
// records, chapter edits and the story bible) plus Ciciro's read on them.
// Reviews are only ever generated on request; the apps surface the newest
// once a week and keep the rest to reread.

function parseObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toStats(raw: string): WeeklyReviewStats {
  const src = parseObject(raw);
  if (!src || typeof src !== "object") return emptyStats();
  return { ...emptyStats(), ...(src as Partial<WeeklyReviewStats>) };
}

export function toWeeklyReview(row: WeeklyReviewRow): WeeklyReview {
  return {
    id: row.id,
    projectId: row.projectId,
    weekStart: row.weekStart,
    weekEnd: row.weekEnd,
    stats: toStats(row.stats),
    content: normalizeContent(parseObject(row.content)),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Newest first. */
export async function listWeeklyReviews(
  projectId: string,
  user: PublicUser | null
): Promise<WeeklyReview[]> {
  await authorizeOwnedProject(projectId, user);
  const rows = await prisma.weeklyReview.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: REVIEWS_LIST_MAX,
  });
  return rows.map(toWeeklyReview);
}

export async function getWeeklyReview(
  projectId: string,
  reviewId: string,
  user: PublicUser | null
): Promise<WeeklyReview> {
  await authorizeOwnedProject(projectId, user);
  const row = await prisma.weeklyReview.findFirst({ where: { id: reviewId, projectId } });
  if (!row) throw new AuthError("Not found.", 404);
  return toWeeklyReview(row);
}

export async function deleteWeeklyReview(
  projectId: string,
  reviewId: string,
  user: PublicUser | null
): Promise<void> {
  await authorizeOwnedProject(projectId, user);
  await prisma.weeklyReview.deleteMany({ where: { id: reviewId, projectId } });
}

/** The window is the seven days ending `to` (the author's local today). */
export function parseWindow(body: unknown): { from: string; to: string } {
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const to = src.to === undefined ? writingDayKey() : src.to;
  if (typeof to !== "string" || !WRITING_DAY_RE.test(to)) {
    throw new AuthError("to must be a YYYY-MM-DD date.", 400);
  }
  return { from: shiftWritingDayKey(to, -(REVIEW_DAYS - 1)), to };
}

export async function gatherStats(
  projectId: string,
  user: PublicUser | null,
  window: { from: string; to: string }
): Promise<WeeklyReviewStats> {
  const since = new Date(Date.now() - REVIEW_DAYS * 24 * 60 * 60 * 1000);
  const [dayRows, chapters, openQuestions, openThreads] = await Promise.all([
    user
      ? prisma.writingDay.findMany({
          where: { userId: user.id, date: { gte: window.from, lte: window.to } },
        })
      : Promise.resolve([]),
    prisma.chapter.findMany({
      where: { projectId, ...visibleChapterWhere },
      orderBy: { order: "asc" },
      select: { id: true, title: true, wordCount: true, updatedAt: true },
    }),
    prisma.openQuestion.count({ where: { projectId, status: "open" } }),
    prisma.plotPoint.count({ where: { projectId, status: "open" } }),
  ]);
  const byDate = new Map(dayRows.map((row) => [row.date, row]));
  const days = writingDayKeysInRange(window.from, window.to).map((date) => ({
    date,
    words: byDate.get(date)?.words ?? 0,
  }));
  const touched = chapters
    .filter((c) => c.updatedAt >= since)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return {
    words: days.reduce((sum, d) => sum + d.words, 0),
    daysWritten: days.filter((d) => d.words > 0).length,
    activeMs: dayRows.reduce((sum, row) => sum + row.activeMs, 0),
    days,
    chaptersTouched: touched.map((c) => ({ id: c.id, title: c.title, wordCount: c.wordCount })),
    totalWords: chapters.reduce((sum, c) => sum + c.wordCount, 0),
    chapterCount: chapters.length,
    openQuestions,
    openThreads,
  };
}

async function reviewInput(
  projectId: string,
  stats: WeeklyReviewStats,
  window: { from: string; to: string }
): Promise<string> {
  const [project, questions, threads, plot] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { title: true, genre: true, logline: true },
    }),
    prisma.openQuestion.findMany({
      where: { projectId, status: "open" },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { question: true, provisional: true, affects: true },
    }),
    prisma.plotPoint.findMany({
      where: { projectId, status: "open" },
      orderBy: { order: "asc" },
      take: 12,
      select: { title: true, description: true, type: true },
    }),
    readBibleFile(projectId, "plot.md").catch(() => ""),
  ]);
  const lines = [
    `Manuscript: ${project?.title ?? "Untitled"}${project?.genre ? ` (${project.genre})` : ""}`,
    project?.logline ? `Logline: ${project.logline}` : "",
    `Week: ${window.from} to ${window.to}`,
    `Words written this week: ${stats.words} across ${stats.daysWritten} of ${REVIEW_DAYS} days`,
    `Per day: ${stats.days.map((d) => `${d.date}=${d.words}`).join(", ")}`,
    `Manuscript total: ${stats.totalWords} words in ${stats.chapterCount} chapters`,
    `Chapters touched: ${
      stats.chaptersTouched.map((c) => `${c.title} (${c.wordCount} words)`).join("; ") || "none"
    }`,
    "",
    "Open questions:",
    ...(questions.length
      ? questions.map(
          (q) =>
            `- ${q.question}${q.provisional ? ` (provisionally: ${q.provisional})` : ""}${
              q.affects ? ` [affects: ${q.affects}]` : ""
            }`
        )
      : ["- none"]),
    "",
    "Open plot threads:",
    ...(threads.length
      ? threads.map((t) => `- [${t.type}] ${t.title}${t.description ? `: ${t.description}` : ""}`)
      : ["- none"]),
  ];
  if (plot.trim()) lines.push("", "Plot notes:", plot.trim().slice(0, 4000));
  return lines.filter((line, i) => line !== "" || lines[i - 1] !== "").join("\n");
}

async function askEditor(input: string): Promise<WeeklyReviewContent> {
  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: DRAFTER_MODEL,
    max_tokens: 1200,
    system: WEEKLY_REVIEW_SYSTEM,
    messages: [{ role: "user", content: input }],
  });
  const text = res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const content = parseReviewJson(text);
  if (!content) throw new AuthError("Ciciro couldn't put a review together. Try again.", 502);
  return content;
}

/** Generate and store a review for the seven days ending `body.to` (default today). */
export async function generateWeeklyReview(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<WeeklyReview> {
  await authorizeOwnedProject(projectId, user);
  const window = parseWindow(body);
  if (!hasAnthropicKey()) {
    throw new AuthError("Weekly reviews need an ANTHROPIC_API_KEY.", 503);
  }
  const stats = await gatherStats(projectId, user, window);
  const content = await askEditor(await reviewInput(projectId, stats, window));
  const row = await prisma.weeklyReview.create({
    data: {
      projectId,
      weekStart: window.from,
      weekEnd: window.to,
      stats: JSON.stringify(stats),
      content: JSON.stringify(content),
    },
  });
  return toWeeklyReview(row);
}
