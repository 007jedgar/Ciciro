"use client";

import { useCallback, useEffect, useState } from "react";
import DrawerHead from "@/components/DrawerHead";
import type { ContinuityCheckFinding, ContinuityCheckResult, ContinuityScope } from "@/lib/continuity-view";
import { reportAiLimit } from "@/lib/billing-client";
import { getAnalytics } from "@/lib/analytics-client";

type Props = {
  projectId: string;
  activeChapterId: string | null;
  activeChapterTitle: string;
  onClose: () => void;
  /** Open Find and replace pre-filled with this chapter quote. */
  onInspect: (text: string) => void;
};

function FindingCard({ finding, onInspect }: { finding: ContinuityCheckFinding; onInspect: (text: string) => void }) {
  return (
    <article className="beta-comment">
      <div className="beta-meta">In the chapter</div>
      <blockquote className="beta-quote">{finding.chapterQuote}</blockquote>
      <div className="beta-meta">Canon says ({finding.canonFile})</div>
      <blockquote className="beta-quote">{finding.canonQuote}</blockquote>
      {finding.note && <p className="beta-body">{finding.note}</p>}
      <div className="beta-actions">
        <button className="btn ghost small" onClick={() => onInspect(finding.chapterQuote)} title="Find this passage">
          Show in text
        </button>
      </div>
    </article>
  );
}

// Extracts the factual claims a chapter makes (names, traits, dates, places)
// and flags what directly contradicts canon.md, world.md, timeline.md, or a
// named character's file. Stays quiet where the bible has no ruling - it
// never guesses a canon fact to fill a gap - and it never edits prose or
// canon; the author decides what, if anything, to fix.
export default function ContinuityCheckPanel({
  projectId,
  activeChapterId,
  activeChapterTitle,
  onClose,
  onInspect,
}: Props) {
  const [scope, setScope] = useState<ContinuityScope>("chapter");
  const [result, setResult] = useState<ContinuityCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeChapterId) setScope("book");
  }, [activeChapterId]);

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
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/continuity-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          scope === "chapter" ? { scope, chapterId: activeChapterId } : { scope: "book" }
        ),
      });
      const data = await res.json().catch(() => ({}));
      reportAiLimit(res.status, data);
      if (!res.ok) throw new Error(data.error || "Couldn't run the continuity check.");
      setResult(data as ContinuityCheckResult);
      getAnalytics().track("continuity_check_run", {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't run the continuity check.");
    } finally {
      setBusy(false);
    }
  }, [projectId, scope, activeChapterId]);

  const groups = new Map<string, { title: string; findings: ContinuityCheckFinding[] }>();
  for (const f of result?.findings ?? []) {
    const g = groups.get(f.chapterId) ?? { title: f.chapterTitle, findings: [] };
    g.findings.push(f);
    groups.set(f.chapterId, g);
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer search-panel" role="dialog" aria-label="Continuity check">
        <DrawerHead title="Continuity check" onClose={onClose} />
        <p className="scratch-hint">
          Checks names, traits, dates, and places the chapter states against canon.md, world.md,
          timeline.md, and the characters it names. Only flags a direct contradiction with a
          specific bible line - it stays quiet where the bible has no ruling, and it never edits
          prose or canon.
        </p>

        {error && (
          <div className="scratch-error" role="alert">
            {error}
          </div>
        )}

        <div className="search-options">
          <button
            className={`btn small ${scope === "chapter" ? "primary" : "ghost"}`}
            disabled={!activeChapterId || busy}
            onClick={() => setScope("chapter")}
          >
            This chapter
          </button>
          <button
            className={`btn small ${scope === "book" ? "primary" : "ghost"}`}
            disabled={busy}
            onClick={() => setScope("book")}
          >
            Whole manuscript
          </button>
        </div>

        <button className="btn primary small" onClick={run} disabled={busy || (scope === "chapter" && !activeChapterId)}>
          {busy ? "Checking…" : "Run check"}
        </button>

        <div className="search-summary" aria-live="polite">
          {scope === "chapter" && activeChapterTitle ? `Scope: "${activeChapterTitle}"` : "Scope: whole manuscript"}
        </div>

        <div className="search-results">
          {busy && (
            <div role="status" aria-label="Checking continuity">
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton short" />
            </div>
          )}
          {!busy && result && result.unchecked.length > 0 && (
            <div className="scratch-error" role="alert">
              {result.unchecked.length === 1
                ? `Couldn't check "${result.unchecked[0].chapterTitle}". Run the check again to include it.`
                : `Couldn't check ${result.unchecked.length} chapters: ${result.unchecked
                    .map((c) => `"${c.chapterTitle}"`)
                    .join(", ")}. Run the check again to include them.`}
            </div>
          )}
          {!busy && result && result.findings.length === 0 && result.unchecked.length === 0 && (
            <div className="empty">Nothing contradicts the bible.</div>
          )}
          {!busy &&
            Array.from(groups.entries()).map(([chapterId, group]) => (
              <div key={chapterId} className="search-group">
                {scope === "book" && <div className="search-group-title">{group.title}</div>}
                {group.findings.map((f, i) => (
                  <FindingCard key={`${chapterId}-${i}`} finding={f} onInspect={onInspect} />
                ))}
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
