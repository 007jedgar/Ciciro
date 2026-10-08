import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, ciciro } from "./api";
import { queryClient } from "./api/query";
import { queryKeys } from "./api/keys";
import type { ChatMessage, ChatSnapshot, ChatStreamEvent, EditorRunInput } from "./api/types";
import { failureFromError, type ChatFailure } from "./chat-errors";
import * as haptics from "./haptics";
import { createWritingTicker } from "./haptics";
import { DEFAULT_EDIT_MODE, editModeOfRuns, editsAllowedFor, type EditMode } from "./edit-mode";
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
  /**
   * Allow edits or Chat only. It belongs to this conversation: every new turn
   * carries it, a reload restores the latest turn's, and clearing the chat (a
   * new thread) puts it back on Allow edits.
   */
  editMode: EditMode;
  setEditMode: (mode: EditMode) => void;
  /** Resolves with the turn's failure when it never reached the editor, else null. */
  send: (input: EditorRunInput) => Promise<ChatFailure | null>;
  /**
   * Stops the turn in flight, keeping the words that already landed. Asks
   * the server to cancel the durable run (it stops at its next safe
   * iteration boundary and is never resumed), then abandons the local read
   * of the stream so the UI frees up immediately.
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

function cachedSnapshot(projectId: string): ChatSnapshot | undefined {
  return projectId
    ? queryClient.getQueryData<ChatSnapshot>(queryKeys.chat.snapshot(projectId))
    : undefined;
}

/**
 * Fetches the transcript and lands it in the persisted query cache (the same
 * one `PersistQueryClientProvider` writes to MMKV), so the next time this
 * conversation opens - another visit, or a cold launch - it paints from that
 * cache before this call's result comes back.
 */
async function fetchAndCacheSnapshot(projectId: string): Promise<ChatSnapshot> {
  const snapshot = await ciciro.chat.get(projectId);
  queryClient.setQueryData(queryKeys.chat.snapshot(projectId), snapshot);
  return snapshot;
}

const CANCEL_ATTEMPTS = 8;
const CANCEL_RETRY_MS = 750;

/**
 * Asks the server to cancel a turn. A Stop that beats the run's creation
 * (the first request is still authorizing) gets a 404, so keep trying until
 * the run exists; any other client error is final.
 */
async function cancelServerRun(projectId: string, turnId: string): Promise<void> {
  for (let attempt = 0; attempt < CANCEL_ATTEMPTS; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, CANCEL_RETRY_MS));
    try {
      await ciciro.chat.cancel(projectId, turnId);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.status !== 404 && err.status < 500) return;
    }
  }
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
  // Seeded synchronously from the persisted cache so a remount (leaving the
  // manuscript and coming back, or a cold launch straight into it) paints
  // the last-seen transcript on its very first render instead of an empty
  // thread that corrects itself once the refetch below lands.
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const cached = cachedSnapshot(projectId);
    return cached ? hydrateChatMessages(cached) : [];
  });
  const [loading, setLoading] = useState(() => Boolean(projectId) && !cachedSnapshot(projectId));
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [stream, setStream] = useState<ChatStreamState>(emptyChatStreamState);
  const [editMode, setEditModeState] = useState<EditMode>(DEFAULT_EDIT_MODE);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  /** Until the author flips it here, the mode follows the thread's latest turn. */
  const editModeTouchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  /** Set only by `stop`, so a clear's abort does not resurrect the transcript. */
  const stopRequestedRef = useRef(false);
  /** The in-flight turn's id, so `stop` can ask the server to cancel it. */
  const turnIdRef = useRef<string | null>(null);
  /** The last turn sent, so Try again can replay it verbatim. */
  const lastInputRef = useRef<EditorRunInput | null>(null);
  /**
   * What Try again repeats: whichever request put up the current failure. A
   * transcript that failed to load has no turn to replay, so it reloads.
   */
  const retryActionRef = useRef<"send" | "reload" | null>(null);

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
    if (!cachedSnapshot(projectId)) setLoading(true);
    try {
      const snapshot = await fetchAndCacheSnapshot(projectId);
      setMessages(hydrateChatMessages(snapshot));
      if (!editModeTouchedRef.current) setEditModeState(editModeOfRuns(snapshot.runs));
      if (!options?.keepFailure) setFailure(null);
    } catch (err) {
      // After a failed turn the turn's failure is the one worth keeping, and
      // Try again should still replay it rather than just refetch.
      if (!options?.keepFailure) {
        retryActionRef.current = "reload";
        setFailure(failureFromError(err));
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Another manuscript is another conversation. Paint whatever is already
    // cached for it before asking the server, so switching never shows an
    // empty thread while the real fetch is in flight.
    editModeTouchedRef.current = false;
    const cached = cachedSnapshot(projectId);
    if (cached) {
      setMessages(hydrateChatMessages(cached));
      setLoading(false);
    }
    setEditModeState(cached ? editModeOfRuns(cached.runs) : DEFAULT_EDIT_MODE);
    void reload();
  }, [projectId, reload]);

  const setEditMode = useCallback((mode: EditMode) => {
    editModeTouchedRef.current = true;
    setEditModeState(mode);
  }, []);

  const send = useCallback(
    async (input: EditorRunInput): Promise<ChatFailure | null> => {
      if (!projectId || streamingRef.current) return null;
      const trimmed = input.message?.trim();
      if (!input.resumeTurnId && !trimmed) return null;

      streamingRef.current = true;
      stopRequestedRef.current = false;
      const clientTurnId = input.clientTurnId ?? newClientTurnId();
      turnIdRef.current = input.resumeTurnId ?? clientTurnId;
      // Chosen when the turn is sent, so Try again repeats it as it was.
      const sent: EditorRunInput = {
        ...input,
        editsAllowed: input.editsAllowed ?? editsAllowedFor(editModeRef.current),
      };
      lastInputRef.current = sent;
      // A run that dies mid-flight resolves with an error footer in the reply,
      // whose Try again replays this turn too.
      retryActionRef.current = "send";
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

      let resumeTurnId = input.resumeTurnId;
      let slices = 0;
      let next = emptyChatStreamState();
      const writing = createWritingTicker();

      try {
        while (slices < MAX_CONTINUATION_SLICES) {
          slices += 1;
          next = emptyChatStreamState();
          if (resumeTurnId) next = { ...next, turnId: resumeTurnId };
          const body: EditorRunInput = resumeTurnId
            ? { projectId, resumeTurnId }
            : { ...sent, projectId, clientTurnId };
          await ciciro.chat.start(
            body,
            (event: ChatStreamEvent) => {
              next = applyChatStreamEvent(next, event);
              if (event.type === "text" && typeof event.v === "string" && !event.resume) {
                writing.feed(event.v);
              } else if (shouldInvalidateProject(event)) {
                writing.landed();
              }
              turnIdRef.current = next.turnId ?? turnIdRef.current;
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
        if (next.status === "failed") haptics.warning();
        else if (next.status !== "cancelled" && (next.status === "completed" || next.text.trim())) haptics.success();
        // Retire the live footer in the same paint as the committed reply.
        // Leaving it up through the reload paints the answer twice and the
        // list jumps.
        setStreaming(false);
        setStream(emptyChatStreamState());
        try {
          const snapshot = await fetchAndCacheSnapshot(projectId);
          setMessages((current) => mergeChatTranscript(hydrateChatMessages(snapshot), current));
          setFailure(null);
        } catch (reloadError) {
          if (!next.text.trim()) throw reloadError;
        }
        // A run that died mid-flight still resolves here — its `[Ciciro error:]`
        // footer rides in the transcript, so the message itself carries the
        // failure and the bar below the composer stays clear.
        return null;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          // Stopping is the author's call, not a failure: keep what Ciciro had
          // written so the turn reads as interrupted rather than erased.
          if (stopRequestedRef.current && next.text.trim()) {
            setMessages((current) => upsertStreamAssistant(current, next));
          }
          return null;
        }
        const failed = failureFromError(err);
        haptics.warning();
        setFailure(failed);
        await reload({ keepFailure: true }).catch(() => {});
        return failed;
      } finally {
        streamingRef.current = false;
        stopRequestedRef.current = false;
        turnIdRef.current = null;
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
    const turnId = turnIdRef.current;
    if (projectId && turnId) {
      // Best-effort: even if this never lands, the local abort below still
      // frees the UI, and a page reload will show whatever the server did
      // land before it noticed the cancellation.
      void cancelServerRun(projectId, turnId);
    }
    abortRef.current?.abort();
  }, [projectId]);

  const retry = useCallback(async () => {
    if (streamingRef.current) return;
    if (retryActionRef.current === "reload") {
      await reload();
      return;
    }
    if (retryActionRef.current !== "send") return;
    const input = lastInputRef.current;
    if (!input) return;
    // A replay is a new turn: drop the id so the server does not resume the run
    // that just failed.
    await send({ ...input, clientTurnId: undefined, resumeTurnId: undefined });
  }, [reload, send]);

  const clear = useCallback(async () => {
    if (!projectId) return null;
    abortRef.current?.abort();
    const result = await ciciro.chat.clear(projectId);
    setMessages([]);
    setFailure(null);
    lastInputRef.current = null;
    // A new thread starts back on Allow edits.
    editModeTouchedRef.current = false;
    setEditModeState(DEFAULT_EDIT_MODE);
    setStream(emptyChatStreamState());
    // Remove rather than invalidate: invalidating only flags the cached
    // snapshot stale without erasing it, and the synchronous cache seed
    // above would otherwise paint the just-archived transcript right back
    // on the next mount, before undo or a fresh fetch had a chance to run.
    queryClient.removeQueries({ queryKey: queryKeys.chat.snapshot(projectId) });
    return result.archivedAt;
  }, [projectId]);

  const undoClear = useCallback(
    async (token: string) => {
      if (!projectId || !token) return;
      try {
        await ciciro.chat.restore(projectId, token);
        // The restored conversation comes back in the mode it was left in.
        editModeTouchedRef.current = false;
        await reload();
        void queryClient.invalidateQueries({
          queryKey: queryKeys.chat.insertions(projectId),
        });
      } catch (err) {
        // Try again only knows how to resend a turn or reload; offering it here
        // would replay the author's last prompt instead of the restore.
        retryActionRef.current = null;
        setFailure({ ...failureFromError(err), retryable: false });
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
    editMode,
    setEditMode,
    send,
    stop,
    retry,
    clear,
    undoClear,
    reload,
  };
}
