import type { TFunction } from "i18next";
import type { DeadlineSnapshot } from "./deadline-pace";

/** A count the way the reader's language writes it (1,500 / 1.500 / 1,500). */
export function formatCount(n: number, locale: string): string {
  try {
    return n.toLocaleString(locale);
  } catch {
    return String(n);
  }
}

/** A YYYY-MM-DD day as a short date in the reader's language, read as local time. */
export function formatDueDate(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  try {
    return new Date(y, m - 1, d).toLocaleDateString(locale, { dateStyle: "medium" });
  } catch {
    return date;
  }
}

/** "Due in 12 days", "Due tomorrow", "Due today" or "Due date passed". */
export function dueText(t: TFunction, snapshot: DeadlineSnapshot): string {
  if (snapshot.daysLeft === 0) return t("deadline.passed");
  if (snapshot.daysLeft === 1) return t("deadline.dueToday");
  if (snapshot.daysLeft === 2) return t("deadline.dueTomorrow");
  return t("deadline.dueIn", { count: snapshot.daysLeft - 1 });
}

/** Ciciro's plain read of how the deadline is going, with the daily words it needs. */
export function verdictText(t: TFunction, snapshot: DeadlineSnapshot, locale: string): string {
  const { status } = snapshot;
  if (status === "complete") return t("deadline.verdict.complete");
  if (status === "pastDue") {
    return t("deadline.verdict.pastDue", {
      count: snapshot.remaining,
      words: formatCount(snapshot.remaining, locale),
    });
  }
  const needed = snapshot.neededPerDay ?? 0;
  return t(`deadline.verdict.${status}`, {
    count: needed,
    needed: formatCount(needed, locale),
    recent: formatCount(snapshot.recentPerDay ?? 0, locale),
  });
}
