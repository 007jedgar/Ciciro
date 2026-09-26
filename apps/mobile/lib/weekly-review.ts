// Helpers for the weekly review screen. Mirrors the display helpers in
// src/lib/weekly-review-view.ts (the phone cannot import from the Next app).

export function weeklyReviewHref(projectId: string): string {
  return `/project/${projectId}/weekly-review`;
}

/** "Sep 20 to Sep 26", from two YYYY-MM-DD keys. */
export function formatWeekRange(start: string, end: string, locale?: string): string {
  const fmt = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, { month: "short", day: "numeric" });
  };
  return `${fmt(start)} to ${fmt(end)}`;
}

/** Height of a day's bar as a 0-1 share of the busiest day, never fully flat. */
export function barShare(words: number, max: number): number {
  if (max <= 0) return 0.06;
  return Math.max(0.06, Math.min(1, words / max));
}
