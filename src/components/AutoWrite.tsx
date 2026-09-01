"use client";

import { useRef, useState } from "react";
import WritingLoader from "@/components/WritingLoader";
import {
  OfflineError,
  StallError,
  readNdjsonStream,
  waitForOnline,
} from "@/lib/ndjson-stream";

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

type PlanBeat = { goal: string; wordTarget: number };
type BeatState = { goal: string; status: string; words?: number };

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
    "idle" | "planning" | "drafting" | "saving" | "done" | "stopped" | "error"
  >("idle");
  const [beats, setBeats] = useState<BeatState[]>([]);
  const [prose, setProse] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const running = phase === "planning" || phase === "drafting" || phase === "saving";

  async function start() {
    setPhase("planning");
    setBeats([]);
    setProse([]);
    setError("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let res: Response;
    try {
      res = await fetch("/api/autowrite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, chapterId, targetWords, guidance }),
        signal: ctrl.signal,
      });
    } catch {
      setPhase("error");
      setError("Request failed to start.");
      return;
    }
    if (!res.body) {
      setPhase("error");
      setError("No response stream.");
      return;
    }

    try {
      await readNdjsonStream(res.body, {
        signal: ctrl.signal,
        stallMs: 90_000,
        onEvent: (e) => handleEvent(e),
      });
    } catch (err) {
      if (ctrl.signal.aborted) {
        setPhase("stopped");
        return;
      }
      if (err instanceof OfflineError) {
        setPhase("error");
        setError("Went offline mid-run. Reconnect, then start again - accepted beats may already be saved.");
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
      setError("Connection dropped mid-run. Try again if the chapter wasn't updated.");
    }
  }

  function handleEvent(e: Record<string, unknown>) {
    switch (e.type) {
      case "phase":
        if (e.v === "saving") setPhase("saving");
        else if (e.v === "planning") setPhase("planning");
        break;
      case "plan": {
        const planBeats = (e.beats as PlanBeat[]) || [];
        setBeats(planBeats.map((b) => ({ goal: b.goal, status: "pending" })));
        setPhase("drafting");
        break;
      }
      case "beat": {
        const idx = (e.i as number) - 1;
        setBeats((prev) =>
          prev.map((b, i) =>
            i === idx
              ? { ...b, status: e.status as string, words: (e.words as number) ?? b.words }
              : b
          )
        );
        break;
      }
      case "prose":
        setProse((p) => [...p, e.v as string]);
        break;
      case "note":
        setSummary((s) => (s ? s + "\n" : "") + (e.v as string));
        break;
      case "stopped":
        setPhase("stopped");
        break;
      case "error":
        setPhase("error");
        setError(e.v as string);
        break;
      case "done":
        setPhase("done");
        setSummary(
          `Drafted ${e.beats as number} beat(s), +${e.words as number} words. Chapter updated.`
        );
        if (typeof e.content === "string") {
          onApplied({
            content: e.content,
            revision: typeof e.revision === "number" ? e.revision : undefined,
            wordCount: typeof e.wordCount === "number" ? e.wordCount : undefined,
          });
        }
        break;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setPhase("stopped");
  }

  const phaseLabel: Record<string, string> = {
    planning: "Planning the chapter...",
    drafting: "Drafting beats...",
    saving: "Saving to the chapter...",
    done: "Done",
    stopped: "Stopped",
    error: "Error",
  };

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
          Ciciro plans <strong>{chapterTitle}</strong> into beats, drafts each with the
          writer, edits it to final against canon, and appends it. You can stop anytime.
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
                <WritingLoader size="sm" label={phaseLabel[phase] || phase} />
              ) : (
                <strong style={{ fontSize: 13 }}>{phaseLabel[phase] || phase}</strong>
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

            {beats.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {beats.map((b, i) => (
                  <div className="bible-item" key={i} style={{ padding: "8px 10px" }}>
                    <div className="row">
                      <span className={`pill ${b.status === "accepted" ? "resolved" : "open"}`}>
                        {b.status === "accepted"
                          ? `done${b.words ? ` (${b.words}w)` : ""}`
                          : b.status}
                      </span>
                      <span style={{ flex: 1, fontSize: 12.5 }}>{b.goal}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {prose.length > 0 && (
              <div className="field">
                <label>Preview</label>
                <div
                  className="draft-block"
                  style={{ maxHeight: 260, overflowY: "auto" }}
                >
                  {prose.join("\n\n")}
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
