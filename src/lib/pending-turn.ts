// Client-side durable state for an in-flight chat turn. Survives tab blips and
// brief offline gaps so we can resume instead of losing the author's request.

export type PendingTurn = {
  projectId: string;
  turnId: string;
  message: string;
  kind: string;
  scope?: "selection" | "chapter" | "book";
  activeChapterId: string | null;
  selection: string;
  /** When true, the editor may create/switch chapters and auto-insert drafts. */
  autoMode?: boolean;
  partialText: string;
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
