import { useCallback, useEffect, useRef, useState } from "react";
import { ciciro } from "./api";
import { ApiError } from "./api/client";
import { queryClient } from "./api/query";
import { queryKeys } from "./api/keys";
import type { ChatMessage, ChatStreamEvent, EditorRunInput } from "./api/types";
import {
  applyChatStreamEvent,
  emptyChatStreamState,
  hydrateChatMessages,
  mergeChatTranscript,
  upsertStreamAssistant,
  MAX_CONTINUATION_SLICES,
  type ChatStreamState,
} from "./ciciro-stream";
import i18n from "./i18n";

export type UseCiciroChat = {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  streaming: boolean;
  stream: ChatStreamState;
  send: (input: EditorRunInput) => Promise<void>;
  clear: () => Promise<void>;
  reload: () => Promise<void>;
};

function newClientTurnId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now().toString(36)}`;
}

function shouldInvalidateProject(event: ChatStreamEvent): boolean {
  if (
    event.type === "chapter_updated" ||
    event.type === "chapter_created" ||
    event.type === "open_chapter"
  ) {
    return true;
  }
  if (event.type === "ui") {
    const inner = (event as { event?: { type?: string } }).event?.type;
    return inner === "chapter_updated" || inner === "chapter_created" || inner === "open_chapter";
  }
  return false;
}

export function useCiciroChat(projectId: string): UseCiciroChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [stream, setStream] = useState<ChatStreamState>(emptyChatStreamState);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);

  const reload = useCallback(async () => {
    if (!projectId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const snapshot = await ciciro.chat.get(projectId);
      setMessages(hydrateChatMessages(snapshot));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : i18n.t("ciciroTab.sendError"));
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
      setStreaming(true);
      setError(null);
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
          setError(null);
        } catch (reloadError) {
          if (!next.text.trim()) throw reloadError;
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof ApiError ? err.message : i18n.t("ciciroTab.sendError"));
        await reload().catch(() => {});
      } finally {
        streamingRef.current = false;
        setStreaming(false);
        setStream(emptyChatStreamState());
        abortRef.current = null;
      }
    },
    [projectId, reload]
  );

  const clear = useCallback(async () => {
    if (!projectId) return;
    abortRef.current?.abort();
    await ciciro.chat.clear(projectId);
    setMessages([]);
    setStream(emptyChatStreamState());
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.snapshot(projectId) });
  }, [projectId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { messages, loading, error, streaming, stream, send, clear, reload };
}
