import { addDays, type DeadlineSnapshot } from "@/lib/deadline-pace";

/** A deadline given no date starts a month out. */
export const DEFAULT_DEADLINE_DAYS_AHEAD = 30;

/** The most digits a word target is typed with. */
export const WORD_TARGET_MAX_DIGITS = 9;

/** A count the way the reader's browser writes it (1,500). */
export function formatCount(n: number, locale?: string): string {
  try {
    return n.toLocaleString(locale);
  } catch {
    return String(n);
  }
}

/** A YYYY-MM-DD day as a short date, read as local time. */
export function formatDueDate(date: string, locale?: string): string {
  const [y, m, d] = date.split("-").map(Number);
  try {
    return new Date(y, m - 1, d).toLocaleDateString(locale, { dateStyle: "medium" });
  } catch {
    return date;
  }
}

/** A typed word target ("12,000", "12 000") as a whole number of at least 1, or null. */
export function parseWordTarget(text: string): number | null {
  const digits = text.replace(/[\s,._]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/** The form a manuscript with no deadline opens on: the next round target and a month out. */
export function defaultDeadlineDraft(
  suggestedGoal: number,
  today: string
): { goal: string; date: string } {
  return { goal: String(suggestedGoal), date: addDays(today, DEFAULT_DEADLINE_DAYS_AHEAD) };
}

const plural = (count: number, one: string, other: string) => (count === 1 ? one : other);

/** "Due in 12 days", "Due tomorrow", "Due today" or "Due date passed". */
export function dueText(snapshot: DeadlineSnapshot): string {
  if (snapshot.daysLeft === 0) return "Due date passed";
  if (snapshot.daysLeft === 1) return "Due today";
  if (snapshot.daysLeft === 2) return "Due tomorrow";
  const days = snapshot.daysLeft - 1;
  return `Due in ${days} ${plural(days, "day", "days")}`;
}

/** The short read of where the deadline stands, for the card. */
export function statusText(snapshot: DeadlineSnapshot): string {
  switch (snapshot.status) {
    case "complete":
      return "Target reached";
    case "pastDue":
      return "Date passed";
    case "ahead":
      return "Comfortably ahead";
    case "onTrack":
      return "On track";
    case "behind":
      return "Needs more pace";
    case "gettingStarted":
      return "Just getting started";
  }
}

/** "4,000 of 10,000 words". */
export function progressText(snapshot: DeadlineSnapshot, locale?: string): string {
  return `${formatCount(snapshot.manuscriptWords, locale)} of ${formatCount(snapshot.wordGoal, locale)} words`;
}

/** Ciciro's plain read of how the deadline is going, with the daily words it needs. */
export function verdictText(snapshot: DeadlineSnapshot, locale?: string): string {
  const { status } = snapshot;
  if (status === "complete") return "You reached your word target. Nicely done.";
  if (status === "pastDue") {
    return `The due date has passed with ${formatCount(snapshot.remaining, locale)} ${plural(
      snapshot.remaining,
      "word",
      "words"
    )} to go. Choose a new date whenever you like.`;
  }
  const needed = snapshot.neededPerDay ?? 0;
  const neededText = `${formatCount(needed, locale)} ${plural(needed, "word", "words")} a day`;
  const recent = formatCount(snapshot.recentPerDay ?? 0, locale);
  switch (status) {
    case "gettingStarted":
      return `You need about ${neededText} to finish by the due date. Write for a few days and Ciciro can tell you how it is going.`;
    case "behind":
      return snapshot.recentPerDay === 0
        ? `Time to pick up the pace. To finish by the due date you need about ${neededText}, and there has been little writing in the last two weeks.`
        : `A little more pace would help. To finish by the due date you need about ${neededText}, and lately it has been about ${recent}.`;
    case "onTrack":
      return `You are on track. You need about ${neededText} and you have been writing about ${recent}.`;
    case "ahead":
      return `You are comfortably ahead. You need about ${neededText} and you have been writing about ${recent}.`;
  }
}
