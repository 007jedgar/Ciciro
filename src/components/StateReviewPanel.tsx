"use client";

import { useCallback, useEffect, useState } from "react";
import DrawerHead from "@/components/DrawerHead";
import { reportAiLimit } from "@/lib/billing-client";
import { getAnalytics } from "@/lib/analytics-client";
import type { StateProposalDraft } from "@/lib/state-review-view";
import { StancePill } from "@/components/KnowledgeStance";
import { characterLabel } from "@/lib/knowledge-view";

type Props = {
  projectId: string;
  chapterId: string | null;
  chapterTitle: string;
  onClose: () => void;
  onInspect: (text: string) => void;
};

const KIND_LABEL: Record<StateProposalDraft["kind"], string> = {
  canon: "Canon",
  plot: "Plot",
  timeline: "Timeline",
  knowledge: "Who knows what",
};

// One chapter, on click. Keep writes a bullet or a fact. Dismiss remembers the
// line so the next run does not offer it. Nothing is written until Keep.
export default function StateReviewPanel({ projectId, chapterId, chapterTitle, onClose, onInspect }: Props) {
  const [proposals, setProposals] = useState<StateProposalDraft[]>([]);
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = useCallback(async () => {
    if (!chapterId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/state-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId }),
      });
      const data = await res.json().catch(() => ({}));
      reportAiLimit(res.status, data);
      if (!res.ok) throw new Error(data.error || "Couldn't review this chapter.");
      setProposals(Array.isArray(data.proposals) ? data.proposals : []);
      setRan(true);
      getAnalytics().track("state_review_run", {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't review this chapter.");
    } finally {
      setBusy(false);
    }
  }, [projectId, chapterId]);

  async function decide(proposal: StateProposalDraft, action: "keep" | "dismiss") {
    if (!chapterId) return;
    const key = `${proposal.kind}:${proposal.text}`;
    setPendingId(key);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/state-review/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId, ...proposal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Couldn't ${action} that line.`);
      if (action === "keep" && proposal.kind === "knowledge") {
        getAnalytics().track("knowledge_fact_kept", {});
      }
      setProposals((rows) => rows.filter((row) => !(row.kind === proposal.kind && row.text === proposal.text)));
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't ${action} that line.`);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer search-panel" role="dialog" aria-label="What changed">
        <DrawerHead title="What changed" onClose={onClose} />
        <p className="scratch-hint">
          Reads this chapter once, when you ask, and proposes lines for canon, plot, timeline, or
          what a character now knows. Nothing is written until you keep it. Dismissed lines stay
          dismissed the next time you check this chapter.
        </p>
        {chapterTitle && <div className="search-summary">Chapter: &ldquo;{chapterTitle}&rdquo;</div>}
        {error && (
          <div className="scratch-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn primary small" onClick={run} disabled={busy || !chapterId}>
          {busy ? "Reading…" : ran ? "Check again" : "Check this chapter"}
        </button>
        <div className="search-results">
          {busy && (
            <div role="status" aria-label="Reviewing the chapter">
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton short" />
            </div>
          )}
          {!busy && ran && proposals.length === 0 && <div className="empty">Nothing new to record.</div>}
          {!busy &&
            proposals.map((proposal) => {
              const key = `${proposal.kind}:${proposal.text}`;
              return (
                <article className="beta-comment" key={key}>
                  <div className="beta-meta">{KIND_LABEL[proposal.kind]}</div>
                  <blockquote className="beta-quote">{proposal.chapterQuote}</blockquote>
                  <p className="beta-body">
                    {proposal.kind === "knowledge" && proposal.stance && proposal.characterPath ? (
                      <>
                        <span className="knowledge-who">{characterLabel(proposal.characterPath)}</span>{" "}
                        <StancePill stance={proposal.stance} /> {proposal.text}
                      </>
                    ) : (
                      proposal.text
                    )}
                  </p>
                  {proposal.note && <p className="scratch-hint">{proposal.note}</p>}
                  <div className="beta-actions">
                    <button
                      className="btn ghost small"
                      onClick={() => onInspect(proposal.chapterQuote)}
                      title="Find this passage"
                    >
                      Show in text
                    </button>
                    <button
                      className="btn primary small"
                      disabled={pendingId !== null}
                      onClick={() => decide(proposal, "keep")}
                    >
                      Keep
                    </button>
                    <button
                      className="btn ghost small"
                      disabled={pendingId !== null}
                      onClick={() => decide(proposal, "dismiss")}
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              );
            })}
        </div>
      </div>
    </>
  );
}
