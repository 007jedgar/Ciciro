import type { ChatMessage, ChatSnapshot, ChatStreamEvent, EditorRunStatus } from "./api/types";

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

/** Fill empty assistant rows from the durable run's visibleOutput. */
export function hydrateChatMessages(snapshot: ChatSnapshot): ChatMessage[] {
  const live = snapshot.messages.filter((message) => !message.archivedAt);
  const byTurn = new Map<string, number>();
  live.forEach((message, index) => {
    if (message.role === "assistant" && message.turnId) byTurn.set(message.turnId, index);
  });
  const extra: ChatMessage[] = [];
  for (const run of snapshot.runs) {
    const output = run.visibleOutput?.trim();
    if (!output) continue;
    const index = byTurn.get(run.turnId);
    if (index != null) {
      if (!live[index].content?.trim()) {
        live[index] = { ...live[index], content: run.visibleOutput };
      }
      continue;
    }
    extra.push({
      id: run.assistantMessageId || `run-${run.id}`,
      role: "assistant",
      content: run.visibleOutput,
      kind: run.kind ?? "chat",
      turnId: run.turnId,
      status: run.status,
      createdAt: run.createdAt,
    });
  }
  return (extra.length ? [...live, ...extra] : live).filter(
    (message) => message.role !== "assistant" || Boolean(message.content?.trim())
  );
}

/** Keep streamed prose on screen when GET still has an empty assistant row. */
export function upsertStreamAssistant(
  messages: ChatMessage[],
  stream: ChatStreamState
): ChatMessage[] {
  const text = stream.text.trim();
  if (!text) return messages;
  const index = messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      (stream.turnId ? message.turnId === stream.turnId : message.id.startsWith("local-assistant"))
  );
  if (index >= 0) {
    if (messages[index].content?.trim()) return messages;
    const next = messages.slice();
    next[index] = { ...messages[index], content: stream.text, turnId: stream.turnId ?? messages[index].turnId };
    return next;
  }
  return [
    ...messages,
    {
      id: `local-assistant-${stream.turnId ?? Date.now()}`,
      role: "assistant",
      content: stream.text,
      kind: "chat",
      turnId: stream.turnId,
      createdAt: new Date().toISOString(),
    },
  ];
}

export function mergeChatTranscript(
  server: ChatMessage[],
  local: ChatMessage[]
): ChatMessage[] {
  const merged = server.map((message) => {
    if (message.role !== "assistant" || message.content?.trim()) return message;
    const fallback = local.find(
      (row) =>
        row.role === "assistant" &&
        row.content.trim() &&
        ((message.turnId && row.turnId === message.turnId) || row.id.startsWith("local-assistant"))
    );
    return fallback ? { ...message, content: fallback.content } : message;
  });
  for (const row of local) {
    if (row.role !== "assistant" || !row.content.trim()) continue;
    const exists = merged.some(
      (message) =>
        message.role === "assistant" &&
        ((row.turnId && message.turnId === row.turnId) || message.content === row.content)
    );
    if (!exists) merged.push(row);
  }
  return merged;
}
