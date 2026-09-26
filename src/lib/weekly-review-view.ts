// Shapes and pure helpers for the weekly review, shared by the store, the
// routes and the web panel. The phone keeps its own copy of the types in
// apps/mobile/lib/api/types.ts.

export const REVIEW_DAYS = 7;
/** A new review is due once the newest one is this old. */
export const REVIEW_DUE_MS = 7 * 24 * 60 * 60 * 1000;
export const REVIEWS_LIST_MAX = 52;
const LIST_ITEM_MAX = 400;
const SUMMARY_MAX = 2000;
const LIST_MAX = 8;

export type WeeklyReviewChapter = {
  id: string;
  title: string;
  wordCount: number;
};

export type WeeklyReviewStats = {
  /** Words written across the author's writing days in the window. */
  words: number;
  daysWritten: number;
  activeMs: number;
  days: { date: string; words: number }[];
  /** Chapters edited during the window, most recent first. */
  chaptersTouched: WeeklyReviewChapter[];
  totalWords: number;
  chapterCount: number;
  openQuestions: number;
  openThreads: number;
};

export type WeeklyReviewContent = {
  summary: string;
  looseEnds: string[];
  nextSteps: string[];
};

export type WeeklyReview = {
  id: string;
  projectId: string;
  weekStart: string;
  weekEnd: string;
  stats: WeeklyReviewStats;
  content: WeeklyReviewContent;
  createdAt: string;
};

export function emptyStats(): WeeklyReviewStats {
  return {
    words: 0,
    daysWritten: 0,
    activeMs: 0,
    days: [],
    chaptersTouched: [],
    totalWords: 0,
    chapterCount: 0,
    openQuestions: 0,
    openThreads: 0,
  };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, LIST_ITEM_MAX))
    .filter(Boolean)
    .slice(0, LIST_MAX);
}

/** Coerce parsed JSON (model output or a stored row) into a well-formed review body. */
export function normalizeContent(value: unknown): WeeklyReviewContent {
  const src = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    summary: typeof src.summary === "string" ? src.summary.trim().slice(0, SUMMARY_MAX) : "",
    looseEnds: strings(src.looseEnds),
    nextSteps: strings(src.nextSteps),
  };
}

/** Pull a JSON object out of model text, tolerating fences and stray prose. */
export function parseReviewJson(raw: string): WeeklyReviewContent | null {
  const trimmed = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const object = trimmed.match(/\{[\s\S]*\}/);
    if (object) {
      try {
        parsed = JSON.parse(object[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed) return null;
  const content = normalizeContent(parsed);
  return content.summary ? content : null;
}

/** True when there is no review yet or the newest one is a week old. */
export function reviewDue(
  reviews: Pick<WeeklyReview, "createdAt">[],
  now = Date.now()
): boolean {
  if (reviews.length === 0) return true;
  const newest = Math.max(...reviews.map((r) => Date.parse(r.createdAt) || 0));
  return now - newest >= REVIEW_DUE_MS;
}

/** "1h 20m", "45m", or "" when there was no typing time. */
export function formatActiveTime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** "Sep 20 to Sep 26", from two YYYY-MM-DD keys. */
export function formatWeekRange(start: string, end: string, locale?: string): string {
  const fmt = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, { month: "short", day: "numeric" });
  };
  return `${fmt(start)} to ${fmt(end)}`;
}
