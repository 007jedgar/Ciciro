"use client";

import { useRef, useState } from "react";
import WritingLoader from "@/components/WritingLoader";
import {
  OfflineError,
  StallError,
  readNdjsonStream,
  waitForOnline,
  type NdjsonEvent,
} from "@/lib/ndjson-stream";
import type { EditorRunStatus } from "@/lib/types";

type Props = {
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  onClose: () => void;
  onApplied: (applied: {
    content: string;
    revision?: number;
    wordCount?: number;
  }) => void;
};

const MAX_CONTINUATION_SLICES = 40;

type SliceResult = {
  status: EditorRunStatus;
  turnId: string;
  runId?: string;
  text: string;
  stopReason?: string | null;
  iterationCount?: number;
  mutationCount?: number;
};

export default function AutoWrite({
  projectId,
  chapterId,
  chapterTitle,
  onClose,
  onApplied,
}: Props) {
  const [targetWords, setTargetWords] = useState(600);
  const [guidance, setGuidance] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "running" | "done" | "stopped" | "error"
  >("idle");
  const [runStatus, setRunStatus] = useState<EditorRunStatus | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [preview, setPreview] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const running = phase === "running";

  async function start() {
    setPhase("running");
    setRunStatus("queued");
    setTools([]);
    setPreview("");
    setSummary("");
    setError("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const turnId = crypto.randomUUID();
    const messageHint = guidance.trim();

    try {
      let fresh = true;
      let resumeTurnId = turnId;
      let continueFrom = "";
      let continuationSlices = 0;
      let last: SliceResult | null = null;

      while (true) {
        const slice = await requestSlice({
          projectId,
          chapterId,
          targetWords,
          guidance: messageHint,
          clientTurnId: turnId,
          resumeTurnId: fresh ? undefined : resumeTurnId,
          continueFrom: fresh ? undefined : continueFrom,
          signal: ctrl.signal,
          onEvent: (event) => handleEvent(event),
        });
        last = slice;
        resumeTurnId = slice.turnId || resumeTurnId;
        continueFrom = slice.text;
        setRunStatus(slice.status);
        if (slice.status !== "continuing") break;
        continuationSlices += 1;
        if (continuationSlices >= MAX_CONTINUATION_SLICES) {
          setTools((current) => [
            ...current,
            "Paused after many continuation slices - start again to keep going.",
          ]);
          break;
        }
        setTools((current) => [
          ...current.filter((line) => !line.startsWith("Saved slice")),
          `Saved slice ${slice.iterationCount ?? ""}; continuing…`.trim(),
        ]);
        fresh = false;
      }

      if (ctrl.signal.aborted) {
        setPhase("stopped");
        return;
      }
      if (!last) throw new Error("Editor run returned no durable state.");
      if (last.status === "failed") {
        setPhase("error");
        setError("The unattended draft failed. Check the backstage trace.");
        return;
      }
      if (last.status === "cancelled") {
        setPhase("stopped");
        return;
      }
      if (last.status === "completed") {
        setPhase("done");
        setSummary(
          last.mutationCount
            ? `Chapter updated after ${last.mutationCount} write(s).`
            : "Unattended draft finished."
        );
        return;
      }
      setPhase("done");
      setSummary("Paused with more work remaining. Start again to resume.");
    } catch (err) {
      if (ctrl.signal.aborted) {
        setPhase("stopped");
        return;
      }
      if (err instanceof OfflineError) {
        setPhase("error");
        setError(
          "Went offline mid-run. Reconnect, then start again - accepted beats may already be saved."
        );
        try {
          await waitForOnline();
        } catch {
          /* ignore */
        }
        return;
      }
      if (err instanceof StallError) {
        setPhase("error");
        setError("Stream stalled. Check your connection and try again.");
        return;
      }
      setPhase("error");
      setError(
        err instanceof Error
          ? err.message
          : "Connection dropped mid-run. Try again if the chapter wasn't updated."
      );
    } finally {
      abortRef.current = null;
    }
  }

  function handleEvent(e: NdjsonEvent) {
    switch (e.type) {
      case "phase":
        if (typeof e.status === "string") {
          setRunStatus(e.status as EditorRunStatus);
        }
        break;
      case "tool":
        if (typeof e.v === "string") {
          const line = e.v;
          setTools((current) => [...current, line]);
        }
        break;
      case "text":
        if (typeof e.v === "string") {
          const chunk = e.v;
          const resume = Boolean(e.resume);
          setPreview((current) => (resume ? chunk : current + chunk));
        }
        break;
      case "chapter_updated": {
        const updated = e as {
          content?: string;
          revision?: number;
          wordCount?: number;
        };
        if (typeof updated.content === "string") {
          onApplied({
            content: updated.content,
            revision:
              typeof updated.revision === "number" ? updated.revision : undefined,
            wordCount:
              typeof updated.wordCount === "number" ? updated.wordCount : undefined,
          });
        }
        break;
      }
      case "error":
        if (typeof e.v === "string") setError(e.v);
        break;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setPhase("stopped");
  }

  const statusLabel =
    runStatus === "verifying"
      ? "Checking the chapter..."
      : runStatus === "continuing"
        ? "Continuing the next slice..."
        : runStatus === "running"
          ? "Drafting the chapter..."
          : runStatus === "queued"
            ? "Starting the unattended draft..."
            : phase === "done"
              ? "Done"
              : phase === "stopped"
                ? "Stopped"
                : phase === "error"
                  ? "Error"
                  : "Drafting...";

  return (
    <>
      <div className="drawer-overlay" onClick={running ? undefined : onClose} />
      <div className="drawer" style={{ width: 560 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>Auto-draft</h2>
          <button className="btn ghost small" onClick={onClose} disabled={running}>
            Close
          </button>
        </div>
        <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 0 }}>
          Ciciro plans <strong>{chapterTitle}</strong> into beats, dispatches each
          to the writer, edits it to final against canon, and inserts it. Work is
          checkpointed if a slice drops; you can stop requesting more slices
          anytime.
        </p>

        {phase === "idle" ? (
          <>
            <div className="field">
              <label>Target length (words)</label>
              <input
                type="number"
                min={200}
                max={4000}
                step={100}
                value={targetWords}
                onChange={(e) => setTargetWords(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Guidance (optional)</label>
              <textarea
                rows={3}
                placeholder="What should happen in this chapter? Any beats, reveals, or constraints."
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
              />
            </div>
            <button className="btn primary" onClick={start}>
              Start drafting
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                margin: "8px 0",
                gap: 12,
              }}
            >
              {running ? (
                <WritingLoader size="sm" label={statusLabel} />
              ) : (
                <strong style={{ fontSize: 13 }}>{statusLabel}</strong>
              )}
              {running ? (
                <button className="btn small" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className="btn small" onClick={() => setPhase("idle")}>
                  New run
                </button>
              )}
            </div>

            {tools.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {tools.map((line, i) => (
                  <div className="bible-item" key={`${i}-${line}`} style={{ padding: "8px 10px" }}>
                    <span className="pill open">{line}</span>
                  </div>
                ))}
              </div>
            )}

            {preview.length > 0 && (
              <div className="field">
                <label>Backstage</label>
                <div
                  className="draft-block"
                  style={{ maxHeight: 260, overflowY: "auto" }}
                >
                  {preview}
                </div>
              </div>
            )}

            {summary && (
              <p style={{ fontSize: 13, color: "var(--draft)" }}>{summary}</p>
            )}
            {error && <p style={{ fontSize: 13, color: "var(--accent)" }}>{error}</p>}
          </>
        )}
      </div>
    </>
  );
}

async function requestSlice(opts: {
  projectId: string;
  chapterId: string;
  targetWords: number;
  guidance: string;
  clientTurnId: string;
  resumeTurnId?: string;
  continueFrom?: string;
  signal: AbortSignal;
  onEvent: (event: NdjsonEvent) => void;
}): Promise<SliceResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new OfflineError();
  }

  const body: Record<string, unknown> = {
    projectId: opts.projectId,
    chapterId: opts.chapterId,
    targetWords: opts.targetWords,
    guidance: opts.guidance,
  };
  if (opts.resumeTurnId) {
    body.resumeTurnId = opts.resumeTurnId;
    if (opts.continueFrom) body.continueFrom = opts.continueFrom;
  } else {
    body.clientTurnId = opts.clientTurnId;
  }

  let res = await fetch("/api/autowrite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (res.status === 409) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    res = await fetch("/api/autowrite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: opts.projectId,
        chapterId: opts.chapterId,
        resumeTurnId: opts.resumeTurnId || opts.clientTurnId,
        continueFrom: opts.continueFrom,
      }),
      signal: opts.signal,
    });
  }

  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("No response stream.");

  let turnId = opts.resumeTurnId || opts.clientTurnId;
  let runId: string | undefined;
  let text = opts.continueFrom || "";
  let status: EditorRunStatus | undefined;
  let stopReason: string | null | undefined;
  let iterationCount: number | undefined;
  let mutationCount: number | undefined;

  await readNdjsonStream(res.body, {
    signal: opts.signal,
    stallMs: 90_000,
    onEvent: (event) => {
      if (event.type === "turn" && typeof event.id === "string") {
        turnId = event.id;
        if (typeof event.runId === "string") runId = event.runId;
      } else if (event.type === "text" && typeof event.v === "string") {
        text = event.resume ? event.v : text + event.v;
      } else if (event.type === "phase" || event.type === "done") {
        const done = event as {
          status?: EditorRunStatus;
          runId?: string;
          stopReason?: string | null;
          iterationCount?: number;
          mutationCount?: number;
        };
        if (done.status) status = done.status;
        if (typeof done.runId === "string") runId = done.runId;
        if (done.stopReason !== undefined) stopReason = done.stopReason;
        if (typeof done.iterationCount === "number") {
          iterationCount = done.iterationCount;
        }
        if (typeof done.mutationCount === "number") {
          mutationCount = done.mutationCount;
        }
      }
      opts.onEvent(event);
    },
  });

  if (!status) throw new Error("Editor stream ended before a durable checkpoint.");
  return {
    status,
    turnId,
    runId,
    text,
    stopReason,
    iterationCount,
    mutationCount,
  };
}
