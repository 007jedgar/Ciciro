import type { WritingDayWords } from "@/lib/deadline-pace";
import { addDays } from "@/lib/deadline-pace";
import { fetchWritingDays } from "@/lib/writing-day-client";

export type DeadlineTarget = {
  wordGoal: number;
  /** YYYY-MM-DD, inclusive. */
  deadline: string;
  /** The server's total; the workspace uses its own live count instead. */
  manuscriptWords: number;
};

/** How far back writing days are read: the pace window, plus enough before it to tell a returning writer from a new one. */
export const DEADLINE_HISTORY_DAYS = 60;

const targetUrl = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/target`;

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

function toTarget(body: { target?: DeadlineTarget | null } | null): DeadlineTarget | null {
  const t = body?.target;
  if (!t) return null;
  return { wordGoal: t.wordGoal, deadline: t.deadline, manuscriptWords: t.manuscriptWords };
}

/** The manuscript's deadline, or null when it has none. Throws when the server cannot say. */
export async function fetchDeadlineTarget(projectId: string): Promise<DeadlineTarget | null> {
  const res = await fetch(targetUrl(projectId), { credentials: "include", cache: "no-store" });
  if (!res.ok) throw await failure(res, "Couldn't load the deadline.");
  return toTarget(await res.json());
}

export async function saveDeadlineTarget(
  projectId: string,
  body: { wordGoal: number; deadline: string }
): Promise<DeadlineTarget> {
  const res = await fetch(targetUrl(projectId), {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, "Couldn't save the deadline.");
  const saved = toTarget(await res.json());
  if (!saved) throw new Error("Couldn't save the deadline.");
  return saved;
}

export async function deleteDeadlineTarget(projectId: string): Promise<void> {
  const res = await fetch(targetUrl(projectId), {
    method: "DELETE",
    credentials: "include",
    keepalive: true,
  });
  if (!res.ok) throw await failure(res, "Couldn't remove the deadline.");
}

/** The author's writing days (every manuscript) ending today; empty when they cannot be read. */
export async function fetchDeadlineDays(today: string): Promise<WritingDayWords[]> {
  const rows = await fetchWritingDays(addDays(today, -DEADLINE_HISTORY_DAYS), today);
  return (rows ?? []).map((row) => ({ date: row.date, words: row.words }));
}
