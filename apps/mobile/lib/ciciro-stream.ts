import type { ChatStreamEvent, EditorRunStatus } from "./api/types";

export const MAX_CONTINUATION_SLICES = 40;

export const TERMINAL_RUN_STATUSES: readonly EditorRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalRunStatus(status: EditorRunStatus | null | undefined): boolean {
  return Boolean(status && (TERMINAL_RUN_STATUSES as readonly string[]).includes(status));
}

export type ChatStreamState = {
  text: string;
  tools: string[];
  turnId: string | null;
  runId: string | null;
  status: EditorRunStatus | null;
};

export function emptyChatStreamState(): ChatStreamState {
  return { text: "", tools: [], turnId: null, runId: null, status: null };
}

export function applyChatStreamEvent(
  state: ChatStreamState,
  evt: ChatStreamEvent
): ChatStreamState {
  if (evt.type === "turn" && typeof evt.id === "string") {
    return {
      ...state,
      turnId: evt.id,
      runId: typeof evt.runId === "string" ? evt.runId : state.runId,
    };
  }
  if (evt.type === "text" && typeof evt.v === "string") {
    return { ...state, text: evt.resume ? evt.v : state.text + evt.v };
  }
  if (evt.type === "tool" && typeof evt.v === "string") {
    return { ...state, tools: [...state.tools, evt.v] };
  }
  if (evt.type === "phase" || evt.type === "done") {
    const status = typeof evt.status === "string" ? (evt.status as EditorRunStatus) : state.status;
    const runId = typeof evt.runId === "string" ? evt.runId : state.runId;
    return { ...state, status, runId };
  }
  return state;
}
