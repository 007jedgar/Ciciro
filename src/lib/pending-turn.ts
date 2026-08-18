import type { EditorRunStatus } from "@/lib/types";

// Client-side durable state for an in-flight chat turn. Survives tab blips,
// bounded server slices, and reloads without creating another generation.

export type PendingTurn = {
  projectId: string;
  turnId: string;
  runId?: string;
  message: string;
  kind: string;
  scope?: "selection" | "chapter" | "book";
  activeChapterId: string | null;
  selection: string;
  /** When true, the editor may create/switch chapters and auto-insert drafts. */
  autoMode?: boolean;
  partialText: string;
  status?: EditorRunStatus;
  stopReason?: string | null;
  iterationCount?: number;
  mutationCount?: number;
  startedAt: number;
};

const PREFIX = "ciciro:pending-turn:";

function key(projectId: string) {
  return PREFIX + projectId;
}

export function loadPendingTurn(projectId: string): PendingTurn | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingTurn;
    if (!parsed?.turnId || parsed.projectId !== projectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingTurn(turn: PendingTurn): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key(turn.projectId), JSON.stringify(turn));
  } catch {
    /* quota / private mode */
  }
}

export function clearPendingTurn(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key(projectId));
  } catch {
    /* ignore */
  }
}

export function updatePendingPartial(
  projectId: string,
  partialText: string
): void {
  const cur = loadPendingTurn(projectId);
  if (!cur) return;
  savePendingTurn({ ...cur, partialText });
}

export function updatePendingRun(
  projectId: string,
  patch: Pick<
    PendingTurn,
    | "runId"
    | "status"
    | "stopReason"
    | "iterationCount"
    | "mutationCount"
  >
): void {
  const cur = loadPendingTurn(projectId);
  if (!cur) return;
  savePendingTurn({ ...cur, ...patch });
}
