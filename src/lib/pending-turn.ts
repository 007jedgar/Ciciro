import type {
  ChatSnapshot,
  EditorRun,
  EditorRunStatus,
} from "@/lib/types";

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

function newestUnfinishedRun(snapshot: ChatSnapshot): EditorRun | undefined {
  return [...snapshot.runs]
    .reverse()
    .find(
      (run) =>
        run.status !== "completed" &&
        run.status !== "failed" &&
        run.status !== "cancelled"
    );
}

/**
 * Reconcile reload state with the database. An authoritative unfinished run
 * wins over a stale session record so reload cannot resurrect a second turn.
 */
export function resolvePendingTurn(
  projectId: string,
  snapshot: ChatSnapshot,
  stored: PendingTurn | null
): PendingTurn | null {
  const storedRun = stored
    ? snapshot.runs.find((run) => run.turnId === stored.turnId)
    : undefined;
  if (
    storedRun &&
    (storedRun.status === "completed" ||
      storedRun.status === "failed" ||
      storedRun.status === "cancelled")
  ) {
    return null;
  }

  const unfinished = storedRun || newestUnfinishedRun(snapshot);
  if (!unfinished) {
    if (
      stored &&
      stored.status !== "completed" &&
      stored.status !== "failed" &&
      stored.status !== "cancelled"
    ) {
      return stored;
    }
    return null;
  }

  const assistant = [...snapshot.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" && message.turnId === unfinished.turnId
    );
  const user = snapshot.messages.find(
    (message) => message.role === "user" && message.turnId === unfinished.turnId
  );
  const sameStored = stored?.turnId === unfinished.turnId ? stored : null;
  const message = sameStored?.message || user?.content || "";
  if (!message) return null;

  return {
    projectId,
    turnId: unfinished.turnId,
    runId: unfinished.id,
    message,
    kind: unfinished.kind || user?.kind || sameStored?.kind || "chat",
    scope: unfinished.scope || sameStored?.scope || undefined,
    activeChapterId:
      unfinished.activeChapterId || sameStored?.activeChapterId || null,
    selection: unfinished.selection || sameStored?.selection || "",
    autoMode: unfinished.autoMode ?? sameStored?.autoMode,
    partialText:
      unfinished.visibleOutput || assistant?.content || sameStored?.partialText || "",
    status: unfinished.status,
    stopReason: unfinished.stopReason,
    iterationCount: unfinished.iterationCount,
    mutationCount: unfinished.mutationCount,
    startedAt:
      Date.parse(unfinished.createdAt) || sameStored?.startedAt || Date.now(),
  };
}
