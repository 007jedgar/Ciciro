/** Shared string helpers for scene-based writing reminder bodies. */

export function composeSceneReminderBody(excerpt: string, nudgeLine: string): string {
  const excerptText = excerpt.trim();
  const nudge = nudgeLine.trim();
  if (!excerptText) return nudge;
  if (!nudge) return excerptText;
  return `${excerptText}\n\n${nudge}`;
}

/** Last 1–2 sentences ending at or before `offset` in plain text. */
export function lastSentencesBefore(text: string, offset: number, max = 2): string {
  if (!text.trim()) return "";
  const end = Math.max(0, Math.min(Math.floor(offset), text.length));
  const head = text.slice(0, end).trimEnd();
  if (!head) return "";
  const parts = head.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
  if (parts.length === 0) return head.slice(-180).trim();
  return parts.slice(-Math.max(1, max)).join(" ").trim();
}
