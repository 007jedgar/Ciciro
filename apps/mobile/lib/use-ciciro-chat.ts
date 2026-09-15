import { useCallback, useEffect, useRef, useState } from "react";
import { ciciro } from "./api";
import { queryClient } from "./api/query";
import { queryKeys } from "./api/keys";
import type { ChatMessage, ChatStreamEvent, EditorRunInput } from "./api/types";
import { failureFromError, type ChatFailure } from "./chat-errors";
import {
  applyChatStreamEvent,
  emptyChatStreamState,
  hydrateChatMessages,
  mergeChatTranscript,
  upsertStreamAssistant,
  MAX_CONTINUATION_SLICES,
  type ChatStreamState,
} from "./ciciro-stream";

export type UseCiciroChat = {
  messages: ChatMessage[];
  loading: boolean;
  /** The last turn's failure, classified. Null once a turn succeeds. */
  failure: ChatFailure | null;
  streaming: boolean;
  stream: ChatStreamState;
  send: (input: EditorRunInput) => Promise<void>;
  /**
   * Abandons the turn in flight, keeping the words that already landed. The
   * server run is not cancelled — there is no endpoint for that — so the rest
   * of its output turns up in the transcript on the next reload.
   */
  stop: () => void;
  /** Re-run the last turn. No-op when nothing has been sent yet. */
  retry: () => Promise<void>;
  /** Archives the conversation; resolves with the handle Undo restores by. */
  clear: () => Promise<string | null>;
  /** Puts back one cleared conversation, by the handle `clear` returned. */
  undoClear: (token: string) => Promise<void>;
  reload: (options?: { keepFailure?: boolean }) => Promise<void>;
};

function newClientTurnId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now().toString(36)}`;
}

const PROJECT_EVENTS = ["chapter_updated", "chapter_created", "open_chapter"];
const QUESTION_EVENTS = ["question_raised", "question_resolved"];

/** Tool UI events arrive bare or wrapped in `{ type: "ui", event }`. */
function uiEventType(event: ChatStreamEvent): string {
  if (event.type === "ui") {
    return (event as { event?: { type?: string } }).event?.type ?? "";
  }
  return event.type;
}

function shouldInvalidateProject(event: ChatStreamEvent): boolean {
  return PROJECT_EVENTS.includes(uiEventType(event));
}

function shouldInvalidateQuestions(event: ChatStreamEvent): boolean {
  return QUESTION_EVENTS.includes(uiEventType(event));
}

export function useCiciroChat(projectId: string): UseCiciroChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [stream, setStream] = useState<ChatStreamState>(emptyChatStreamState);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  /** Set only by `stop`, so a clear's abort does not resurrect the transcript. */
  const stopRequestedRef = useRef(false);
  /** The last turn sent, so Try again can replay it verbatim. */
  const lastInputRef = useRef<EditorRunInput | null>(null);

  /**
   * Refetch the transcript. `keepFailure` is for the reload that follows a
   * failed turn: the turn failed, not the fetch, so a successful refetch must
   * not quietly erase what the author is being told.
   */
  const reload = useCallback(async (options?: { keepFailure?: boolean }) => {
    if (!projectId) {
      setMessages([]);
      setLoading(false);
      if (!options?.keepFailure) setFailure(null);
      return;
    }
    setLoading(true);
    try {
      const snapshot = await ciciro.chat.get(projectId);
      setMessages(hydrateChatMessages(snapshot));
      if (!options?.keepFailure) setFailure(null);
    } catch (err) {
      setFailure(failureFromError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const send = useCallback(
    async (input: EditorRunInput) => {
      if (!projectId || streamingRef.current) return;
      const trimmed = input.message?.trim();
      if (!input.resumeTurnId && !trimmed) return;

      streamingRef.current = true;
      stopRequestedRef.current = false;
      lastInputRef.current = input;
      setStreaming(true);
      setFailure(null);
      setStream(emptyChatStreamState());
      const abort = new AbortController();
      abortRef.current = abort;

      if (trimmed) {
        setMessages((current) => [
          ...current,
          {
            id: `local-${Date.now()}`,
            role: "user",
            content: trimmed,
            kind: input.kind ?? "chat",
            createdAt: new Date().toISOString(),
          },
        ]);
      }

      const clientTurnId = input.clientTurnId ?? newClientTurnId();
      let resumeTurnId = input.resumeTurnId;
      let slices = 0;
      let next = emptyChatStreamState();

      try {
        while (slices < MAX_CONTINUATION_SLICES) {
          slices += 1;
          next = emptyChatStreamState();
          if (resumeTurnId) next = { ...next, turnId: resumeTurnId };
          const body: EditorRunInput = resumeTurnId
            ? { projectId, resumeTurnId }
            : { ...input, projectId, clientTurnId };
          await ciciro.chat.start(
            body,
            (event: ChatStreamEvent) => {
              next = applyChatStreamEvent(next, event);
              setStream({ ...next });
              if (shouldInvalidateProject(event)) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
              }
              if (shouldInvalidateQuestions(event)) {
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.questions.all(projectId),
                });
              }
            },
            { signal: abort.signal }
          );
          if (next.status !== "continuing" || !next.turnId) break;
          resumeTurnId = next.turnId;
        }
        if (next.text.trim()) {
          setMessages((current) => upsertStreamAssistant(current, next));
        }
        try {
          const snapshot = await ciciro.chat.get(projectId);
          setMessages((current) => mergeChatTranscript(hydrateChatMessages(snapshot), current));
          setFailure(null);
        } catch (reloadError) {
          if (!next.text.trim()) throw reloadError;
        }
        // A run that died mid-flight still resolves here — its `[Ciciro error:]`
        // footer rides in the transcript, so the message itself carries the
        // failure and the bar below the composer stays clear.
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          // Stopping is the author's call, not a failure: keep what Ciciro had
          // written so the turn reads as interrupted rather than erased.
          if (stopRequestedRef.current && next.text.trim()) {
            setMessages((current) => upsertStreamAssistant(current, next));
          }
          return;
        }
        setFailure(failureFromError(err));
        await reload({ keepFailure: true }).catch(() => {});
      } finally {
        streamingRef.current = false;
        stopRequestedRef.current = false;
        setStreaming(false);
        setStream(emptyChatStreamState());
        abortRef.current = null;
      }
    },
    [projectId, reload]
  );

  const stop = useCallback(() => {
    if (!streamingRef.current) return;
    stopRequestedRef.current = true;
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(async () => {
    const input = lastInputRef.current;
    if (!input || streamingRef.current) return;
    // A replay is a new turn: drop the id so the server does not resume the run
    // that just failed.
    await send({ ...input, clientTurnId: undefined, resumeTurnId: undefined });
  }, [send]);

  const clear = useCallback(async () => {
    if (!projectId) return null;
    abortRef.current?.abort();
    const result = await ciciro.chat.clear(projectId);
    setMessages([]);
    setFailure(null);
    lastInputRef.current = null;
    setStream(emptyChatStreamState());
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.snapshot(projectId) });
    return result.archivedAt;
  }, [projectId]);

  const undoClear = useCallback(
    async (token: string) => {
      if (!projectId || !token) return;
      try {
        await ciciro.chat.restore(projectId, token);
        await reload();
        void queryClient.invalidateQueries({
          queryKey: queryKeys.chat.insertions(projectId),
        });
      } catch (err) {
        setFailure(failureFromError(err));
      }
    },
    [projectId, reload]
  );

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    messages,
    loading,
    failure,
    streaming,
    stream,
    send,
    stop,
    retry,
    clear,
    undoClear,
    reload,
  };
}
