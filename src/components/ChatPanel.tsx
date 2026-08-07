"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { QUICK_ACTIONS, type QuickAction } from "@/lib/prompts";
import type { ChatMessage, ClientUiEvent, DraftInsertion } from "@/lib/types";
import WritingLoader from "@/components/WritingLoader";
import {
  clearPendingTurn,
  loadPendingTurn,
  savePendingTurn,
  updatePendingPartial,
  type PendingTurn,
} from "@/lib/pending-turn";
import {
  OfflineError,
  StallError,
  pollForTurnAssistant,
  readNdjsonStream,
  waitForOnline,
  type NdjsonEvent,
} from "@/lib/ndjson-stream";
import { closeOpenDrafts, hasOpenDraft } from "@/lib/heal";
import { parseSegments } from "@/lib/segments";

type Scope = "selection" | "chapter" | "book";

export type ChatHandle = {
  send: (message: string, kind?: string, scope?: Scope) => void;
};

type Props = {
  projectId: string;
  activeChapterId: string | null;
  getSelection: () => string;
  // `key` groups every draft insert from the same message so the editor can
  // keep them in the right order (see EditorHandle.insertDraft).
  onInsertDraft: (text: string, key: string) => void;
  onTurnComplete?: () => void;
  /** Live chapter focus / content updates from editor tools mid-turn. */
  onUiEvent?: (evt: ClientUiEvent) => void;
};

type ConnState = "online" | "offline" | "reconnecting" | "stalled";

function insertionKey(turnId: string, segmentIndex: number) {
  return `${turnId}:${segmentIndex}`;
}

function recordDraftInsertion(opts: {
  projectId: string;
  turnId: string;
  segmentIndex: number;
  chapterId: string | null;
}) {
  if (!opts.chapterId || !opts.turnId) return;
  fetch("/api/chat/insertions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: opts.projectId,
      turnId: opts.turnId,
      segmentIndex: opts.segmentIndex,
      chapterId: opts.chapterId,
    }),
  }).catch(() => {});
}

// Render a message body: markdown for prose, insertable blocks for <draft>.
// Insertion state keys on (turnId, segmentIndex) so it survives the streaming
// temp message id → persisted DB id swap and page reloads.
function renderBody(
  content: string,
  insertGroupKey: string,
  turnId: string | null | undefined,
  insertedKeys: Set<string>,
  onInsert: (text: string, key: string) => void,
  markInserted: (draftKey: string) => void,
  onDurableInsert: (segmentIndex: number) => void,
  live: boolean
) {
  const display = !live && hasOpenDraft(content) ? closeOpenDrafts(content) : content;
  return parseSegments(display).map((seg, idx) => {
    if (seg.kind === "md") {
      if (!seg.text.trim()) return null;
      return (
        <div className="md" key={idx}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
        </div>
      );
    }
    const draft = seg.text.trim();
    const draftKey = turnId
      ? insertionKey(turnId, idx)
      : `${insertGroupKey}:${idx}`;
    const inserted = insertedKeys.has(draftKey);
    const stillWriting = seg.open && live;
    return (
      <div className="draft-block" key={idx}>
        {draft || "..."}
        {stillWriting ? (
          <div className="draft-actions">
            <span style={{ fontSize: 11, color: "var(--ink-soft)", fontStyle: "italic" }}>
              writing...
            </span>
          </div>
        ) : (
          <div className="draft-actions">
            <button
              className={`btn small ${inserted ? "ghost" : "primary"}`}
              disabled={inserted}
              onClick={() => {
                onInsert(draft, insertGroupKey);
                markInserted(draftKey);
                onDurableInsert(idx);
              }}
            >
              {inserted ? "Inserted" : "Insert into manuscript"}
            </button>
            <button
              className="btn ghost small"
              onClick={() => navigator.clipboard?.writeText(draft)}
            >
              Copy
            </button>
          </div>
        )}
      </div>
    );
  });
}

const ChatPanel = forwardRef<ChatHandle, Props>(function ChatPanel(
  {
    projectId,
    activeChapterId,
    getSelection,
    onInsertDraft,
    onTurnComplete,
    onUiEvent,
  },
  ref
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamTools, setStreamTools] = useState<string[]>([]);
  const [streamMsgId, setStreamMsgId] = useState<string | null>(null);
  const [selection, setSelection] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [insertedKeys, setInsertedKeys] = useState<Set<string>>(new Set());
  const [conn, setConn] = useState<ConnState>("online");
  const [compacting, setCompacting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const streamTurnIdRef = useRef<string | null>(null);
  const activeChapterRef = useRef(activeChapterId);
  activeChapterRef.current = activeChapterId;
  const autoModeRef = useRef(autoMode);
  autoModeRef.current = autoMode;
  const onUiEventRef = useRef(onUiEvent);
  onUiEventRef.current = onUiEvent;

  function markInserted(draftKey: string) {
    setInsertedKeys((prev) => new Set(prev).add(draftKey));
  }

  const refreshInsertions = useCallback(async () => {
    const r = await fetch(`/api/chat/insertions?projectId=${projectId}`);
    const data = await r.json();
    if (!Array.isArray(data)) return;
    setInsertedKeys((prev) => {
      const next = new Set(prev);
      for (const row of data as DraftInsertion[]) {
        next.add(insertionKey(row.turnId, row.segmentIndex));
      }
      return next;
    });
  }, [projectId]);

  const refreshMessages = useCallback(async () => {
    const r = await fetch(`/api/chat?projectId=${projectId}`);
    const data = await r.json();
    if (Array.isArray(data)) setMessages(data);
    await refreshInsertions().catch(() => {});
    return Array.isArray(data) ? (data as ChatMessage[]) : [];
  }, [projectId, refreshInsertions]);

  useEffect(() => {
    refreshMessages().catch(() => {});
  }, [refreshMessages]);

  useEffect(() => {
    const t = setInterval(() => setSelection(getSelection()), 400);
    return () => clearInterval(t);
  }, [getSelection]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText, streamTools]);

  useEffect(() => {
    const goOnline = () => setConn((c) => (c === "offline" ? "online" : c));
    const goOffline = () => setConn("offline");
    if (typeof navigator !== "undefined" && !navigator.onLine) setConn("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Auto mode: as soon as a <draft> block finishes streaming, insert it
  // without waiting for a button click. Keys use the live turnId so they
  // match the durable DraftInsertion rows after refresh.
  useEffect(() => {
    if (!autoMode || !streaming || !streamMsgId) return;
    const turnId = streamTurnIdRef.current;
    parseSegments(streamText).forEach((seg, idx) => {
      if (seg.kind !== "draft" || seg.open) return;
      const draft = seg.text.trim();
      if (!draft) return;
      const draftKey = turnId
        ? insertionKey(turnId, idx)
        : `${streamMsgId}:${idx}`;
      if (insertedKeys.has(draftKey)) return;
      onInsertDraft(draft, streamMsgId);
      markInserted(draftKey);
      if (turnId) {
        recordDraftInsertion({
          projectId,
          turnId,
          segmentIndex: idx,
          chapterId: activeChapterRef.current,
        });
      }
    });
  }, [
    streamText,
    autoMode,
    streaming,
    streamMsgId,
    insertedKeys,
    onInsertDraft,
    projectId,
  ]);

  async function consumeChatStream(
    res: Response,
    opts: {
      assistantId: string;
      projectId: string;
      turn: PendingTurn;
      signal: AbortSignal;
      onTurnId: (id: string) => void;
    }
  ): Promise<{ text: string; status: string; turnId: string }> {
    if (!res.body) throw new Error("No response stream");

    let acc = "";
    const tools: string[] = [];
    let turnId = opts.turn.turnId;
    let doneStatus = "complete";

    await readNdjsonStream(res.body, {
      signal: opts.signal,
      stallMs: 50_000,
      onActivity: () => {
        setConn((c) => (c === "stalled" || c === "reconnecting" ? "online" : c));
      },
      onEvent: (evt: NdjsonEvent) => {
        if (evt.type === "turn" && typeof evt.id === "string") {
          turnId = evt.id;
          streamTurnIdRef.current = turnId;
          opts.onTurnId(turnId);
          savePendingTurn({ ...opts.turn, turnId });
        } else if (evt.type === "text" && typeof evt.v === "string") {
          // Server replay/resume seeds replace the bubble; deltas append.
          if (evt.resume) acc = evt.v;
          else acc += evt.v;
          setStreamText(acc);
          opts.turn.partialText = acc;
          updatePendingPartial(opts.projectId, acc);
        } else if (evt.type === "tool" && typeof evt.v === "string") {
          tools.push(evt.v);
          setStreamTools([...tools]);
        } else if (
          evt.type === "open_chapter" ||
          evt.type === "chapter_created" ||
          evt.type === "chapter_updated"
        ) {
          onUiEventRef.current?.(evt as unknown as ClientUiEvent);
        } else if (evt.type === "done") {
          doneStatus = typeof evt.status === "string" ? evt.status : "complete";
        }
      },
    });

    return { text: acc, status: doneStatus, turnId };
  }

  async function postChat(
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Response> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new OfflineError();
    }
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const ct = res.headers.get("content-type") || "";
    // 404 on resume is handled by the caller (fall back to a fresh send).
    if (!res.ok && res.status !== 404) {
      if (ct.includes("application/json")) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return res;
  }

  /**
   * After a stall/offline/drop: wait for connectivity, poll in case the server
   * finished anyway, otherwise re-request continuation of the hanging turn.
   */
  async function recoverTurn(
    turn: PendingTurn,
    assistantId: string,
    signal: AbortSignal,
    localPartial: string
  ): Promise<{ text: string; status: string; turnId: string }> {
    setConn("reconnecting");
    setStreamTools((t) =>
      t.includes("Reconnecting…") ? t : [...t, "Reconnecting…"]
    );

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setConn("offline");
      await waitForOnline(signal);
      setConn("reconnecting");
    }

    // If we never got prose, the server may still be thinking - wait longer
    // before starting a second generation. If we already had text, a short poll
    // is enough to catch a finish-race, then we resume from the partial.
    const hadPartial = Boolean(
      (localPartial || turn.partialText || "").trim()
    );
    const found = await pollForTurnAssistant(turn.projectId, turn.turnId, {
      timeoutMs: hadPartial ? 6_000 : 40_000,
      signal,
    });
    if (found?.status === "complete" && found.content.trim()) {
      setStreamText(found.content);
      return { text: found.content, status: "complete", turnId: turn.turnId };
    }
    if (found?.status === "partial" && found.content.trim() && !hadPartial) {
      localPartial = found.content;
      setStreamText(found.content);
    }

    const continueFrom = localPartial || found?.content || turn.partialText || "";

    // Resume if the server already has the turn; otherwise the original POST
    // never landed (offline before the request) - send it fresh with the same
    // clientTurnId so a later drop can still correlate.
    let res: Response;
    try {
      res = await postChat(
        {
          projectId: turn.projectId,
          resumeTurnId: turn.turnId,
          continueFrom,
          activeChapterId: turn.activeChapterId,
          selection: turn.selection,
          kind: turn.kind,
          scope: turn.scope,
          autoMode: turn.autoMode ?? autoModeRef.current,
        },
        signal
      );
      if (res.status === 404) {
        res = await postChat(
          {
            projectId: turn.projectId,
            message: turn.message,
            activeChapterId: turn.activeChapterId,
            selection: turn.selection,
            kind: turn.kind,
            scope: turn.scope,
            autoMode: turn.autoMode ?? autoModeRef.current,
            clientTurnId: turn.turnId,
          },
          signal
        );
      }
    } catch (err) {
      throw err;
    }

    return consumeChatStream(res, {
      assistantId,
      projectId: turn.projectId,
      turn: { ...turn, partialText: continueFrom },
      signal,
      onTurnId: (id) => {
        turn.turnId = id;
      },
    });
  }

  async function runTurn(turn: PendingTurn, isResume: boolean) {
    if (streamingRef.current) return;
    streamingRef.current = true;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const assistantId = `a-${Date.now()}`;

    if (!isResume) {
      setMessages((m) => [
        ...m,
        {
          id: `tmp-${Date.now()}`,
          role: "user",
          content: turn.message,
          kind: turn.kind,
          turnId: turn.turnId,
          status: "complete",
          createdAt: new Date().toISOString(),
        },
      ]);
      setInput("");
    }

    setStreaming(true);
    setStreamText(turn.partialText || "");
    setStreamTools(isResume ? ["Resuming interrupted reply…"] : []);
    setStreamMsgId(assistantId);
    streamTurnIdRef.current = turn.turnId;
    savePendingTurn(turn);

    let result: { text: string; status: string; turnId: string } | null = null;
    const maxAttempts = 4;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          if (attempt === 0 && !isResume) {
            const res = await postChat(
              {
                projectId: turn.projectId,
                message: turn.message,
                activeChapterId: turn.activeChapterId,
                selection: turn.selection,
                kind: turn.kind,
                scope: turn.scope,
                autoMode: turn.autoMode ?? autoModeRef.current,
                clientTurnId: turn.turnId,
              },
              ctrl.signal
            );
            result = await consumeChatStream(res, {
              assistantId,
              projectId: turn.projectId,
              turn,
              signal: ctrl.signal,
              onTurnId: (id) => {
                turn.turnId = id;
              },
            });
          } else {
            result = await recoverTurn(
              turn,
              assistantId,
              ctrl.signal,
              result?.text || turn.partialText
            );
          }

          if (result.status === "partial" && attempt < maxAttempts - 1) {
            setConn("reconnecting");
            turn.partialText = result.text;
            continue;
          }
          break;
        } catch (err) {
          if (ctrl.signal.aborted) throw err;
          if (err instanceof OfflineError) {
            setConn("offline");
            await waitForOnline(ctrl.signal);
            setConn("reconnecting");
            continue;
          }
          if (err instanceof StallError) {
            setConn("stalled");
            continue;
          }
          // Network / parse failures: try recover path.
          if (attempt < maxAttempts - 1) {
            setConn("reconnecting");
            continue;
          }
          // Last resort: resync whatever the server persisted.
          try {
            const data = await refreshMessages();
            const assistant = [...data]
              .reverse()
              .find((m) => m.role === "assistant" && m.turnId === turn.turnId);
            if (assistant) {
              result = {
                text: assistant.content,
                status: assistant.status || "complete",
                turnId: turn.turnId,
              };
              break;
            }
          } catch {
            /* ignore */
          }
          throw err;
        }
      }

      if (result?.text) {
        setMessages((m) => [
          ...m.filter((x) => x.id !== assistantId),
          {
            id: assistantId,
            role: "assistant",
            content: result!.text,
            kind: turn.kind,
            turnId: result!.turnId,
            status: result!.status,
            createdAt: new Date().toISOString(),
          },
        ]);
        // Prefer authoritative ids from the DB once the turn settles.
        refreshMessages().catch(() => {});
      }
      clearPendingTurn(projectId);
      setConn("online");
    } catch {
      try {
        await refreshMessages();
      } catch {
        /* best effort */
      }
    } finally {
      setStreamText("");
      setStreamTools([]);
      setStreamMsgId(null);
      streamTurnIdRef.current = null;
      setStreaming(false);
      streamingRef.current = false;
      abortRef.current = null;
      onTurnComplete?.();
    }
  }

  async function send(message: string, kind = "chat", scope?: Scope) {
    if (!message.trim() || streamingRef.current) return;
    const turnId = crypto.randomUUID();
    streamTurnIdRef.current = turnId;
    const turn: PendingTurn = {
      projectId,
      turnId,
      message: message.trim(),
      kind,
      scope,
      activeChapterId: activeChapterRef.current,
      selection: getSelection(),
      autoMode: autoModeRef.current,
      partialText: "",
      startedAt: Date.now(),
    };
    await runTurn(turn, false);
  }

  // On mount / project change: resume any turn left hanging by a refresh or crash.
  useEffect(() => {
    const pending = loadPendingTurn(projectId);
    if (!pending || streamingRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const data = await refreshMessages();
        if (cancelled) return;
        const assistant = [...data]
          .reverse()
          .find((m) => m.role === "assistant" && m.turnId === pending.turnId);
        if (assistant?.status === "complete") {
          clearPendingTurn(projectId);
          return;
        }
        const partial =
          assistant?.content || pending.partialText || "";
        await runTurn({ ...pending, partialText: partial }, true);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only re-check when the project changes; runTurn is stable enough via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const sendRef = useRef(send);
  sendRef.current = send;
  useImperativeHandle(
    ref,
    () => ({
      send: (message: string, kind?: string, scope?: Scope) =>
        sendRef.current(message, kind, scope),
    }),
    []
  );

  async function clearChat() {
    if (streaming) return;
    if (!confirm("Clear this conversation? This can't be undone.")) return;
    abortRef.current?.abort();
    clearPendingTurn(projectId);
    await fetch(`/api/chat?projectId=${projectId}`, { method: "DELETE" });
    setMessages([]);
    setInsertedKeys(new Set());
  }

  async function compactNow() {
    if (streaming || compacting) return;
    setCompacting(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, compactOnly: true }),
      });
      const data = await res.json();
      if (data.compacted) await refreshMessages();
      else alert("Chat is already within the context budget.");
    } catch {
      alert("Couldn't compact right now - check your connection and API key.");
    } finally {
      setCompacting(false);
    }
  }

  function runAction(a: QuickAction) {
    if (a.scope === "selection" && !getSelection().trim()) {
      alert("Highlight some text in the manuscript first, then run this action.");
      return;
    }
    send(a.prompt, "action", a.scope);
  }

  const banner =
    conn === "offline"
      ? "You're offline. Ciciro will resume when the connection returns."
      : conn === "reconnecting"
        ? "Connection blip - reconnecting and picking up where we left off…"
        : conn === "stalled"
          ? "Stream went quiet - checking the connection…"
          : null;

  return (
    <div className="chat">
      <div className="chat-head">
        <span className={`dot ${conn !== "online" ? "warn" : ""}`} />
        <h2>Ciciro</h2>
        <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>editor</span>
        <span style={{ flex: 1 }} />
        <button
          className="btn ghost small"
          title="Summarize older messages to free context space"
          disabled={streaming || compacting || messages.length < 8}
          onClick={compactNow}
        >
          {compacting ? "Compacting…" : "Compact"}
        </button>
        <button
          className="btn ghost small"
          title="Clear the conversation and start fresh"
          disabled={streaming || messages.length === 0}
          onClick={clearChat}
        >
          Clear chat
        </button>
        <button
          className={`btn small ${autoMode ? "primary" : "ghost"}`}
          title="When on, finished drafts insert into the open chapter automatically. Ciciro can also create and switch chapters."
          onClick={() => setAutoMode((v) => !v)}
        >
          Auto {autoMode ? "on" : "off"}
        </button>
      </div>

      {banner && <div className="conn-banner">{banner}</div>}

      <div className="quick-actions">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.id}
            className="chip"
            title={a.hint}
            disabled={streaming}
            onClick={() => runAction(a)}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && !streaming && (
          <div className="empty">
            Talk to Ciciro, your editor. It sees the story bible and manuscript, makes
            the calls, and hands prose to a faster writer behind the scenes.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="who">
              {m.kind === "compact"
                ? "Earlier context"
                : m.role === "user"
                  ? "You"
                  : "Ciciro"}
              {m.status === "partial" ? " · interrupted" : ""}
            </div>
            <div className="bubble">
              {m.role === "assistant"
                ? renderBody(
                    m.content,
                    m.id,
                    m.turnId,
                    insertedKeys,
                    onInsertDraft,
                    markInserted,
                    (segmentIndex) => {
                      if (!m.turnId) return;
                      recordDraftInsertion({
                        projectId,
                        turnId: m.turnId,
                        segmentIndex,
                        chapterId: activeChapterRef.current,
                      });
                    },
                    false
                  )
                : m.kind === "compact"
                  ? (
                      <div className="md compact-note">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content}
                        </ReactMarkdown>
                      </div>
                    )
                  : m.content}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="msg assistant">
            <div className="who">Ciciro</div>
            {streamTools.length > 0 && (
              <div className="tool-trace">
                {streamTools.map((t, i) => (
                  <div key={i} className="tool-line">
                    {t}
                  </div>
                ))}
              </div>
            )}
            <div className="bubble">
              {streamText
                ? renderBody(
                    streamText,
                    streamMsgId ?? "streaming",
                    streamTurnIdRef.current,
                    insertedKeys,
                    onInsertDraft,
                    markInserted,
                    (segmentIndex) => {
                      const turnId = streamTurnIdRef.current;
                      if (!turnId) return;
                      recordDraftInsertion({
                        projectId,
                        turnId,
                        segmentIndex,
                        chapterId: activeChapterRef.current,
                      });
                    },
                    true
                  )
                : (
                    <WritingLoader
                      label={
                        conn === "offline"
                          ? "Waiting for connection…"
                          : conn === "reconnecting" || conn === "stalled"
                            ? "Reconnecting…"
                            : streamTools.length > 0
                              ? "Working through it…"
                              : "Thinking…"
                      }
                    />
                  )}
            </div>
          </div>
        )}
      </div>

      {selection.trim() && (
        <div className="selection-note">
          {selection.trim().split(/\s+/).length} words selected - actions can target it
        </div>
      )}

      <div className="composer">
        <textarea
          placeholder="Ask your editor, or describe what to write..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button
          className="btn primary"
          disabled={streaming || !input.trim()}
          onClick={() => send(input)}
        >
          Send
        </button>
      </div>
    </div>
  );
});

export default ChatPanel;
