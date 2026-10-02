"use client";

import { useCallback, useEffect, useState } from "react";
import DrawerHead from "@/components/DrawerHead";
import { fetchRepetitionReport, type ManuscriptRepetitionReport, type RepetitionFlag } from "@/lib/repetition-client";
import { getAnalytics } from "@/lib/analytics-client";

type Scope = "chapter" | "manuscript";

type Props = {
  projectId: string;
  activeChapterId: string | null;
  onClose: () => void;
  /** Open Find and replace pre-filled with this word or phrase. */
  onInspect: (text: string) => void;
};

function FlagRow({ flag, onInspect }: { flag: RepetitionFlag; onInspect: (text: string) => void }) {
  return (
    <div className="search-hit">
      <button className="search-hit-text" onClick={() => onInspect(flag.text)} title="Find every occurrence">
        {flag.text}
      </button>
      <span className="pill" title={`${flag.perThousand} per 1,000 words`}>
        {flag.count}×
      </span>
    </div>
  );
}

function FlagSection({
  title,
  flags,
  onInspect,
}: {
  title: string;
  flags: RepetitionFlag[];
  onInspect: (text: string) => void;
}) {
  if (flags.length === 0) return null;
  return (
    <div className="search-group">
      <div className="search-group-title">{title}</div>
      {flags.map((f) => (
        <FlagRow key={f.text} flag={f} onInspect={onInspect} />
      ))}
    </div>
  );
}

// A lint-style pass over the manuscript: words and phrases used above a
// frequency threshold, ignoring stop words and story-bible character names.
// Deterministic - no LLM call - so it's cheap to run on demand. It only
// reports; the author decides what, if anything, to change.
export default function RepetitionPanel({ projectId, activeChapterId, onClose, onInspect }: Props) {
  const [report, setReport] = useState<ManuscriptRepetitionReport | null>(null);
  const [scope, setScope] = useState<Scope>("chapter");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const found = await fetchRepetitionReport(projectId, signal);
        setReport(found);
        getAnalytics().track("repetition_report_viewed", {});
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeChapter = report?.chapters.find((c) => c.chapterId === activeChapterId) ?? null;
  // Fall back to the manuscript view when there's no open chapter to scope to.
  const effectiveScope: Scope = activeChapter ? scope : "manuscript";
  const scoped = effectiveScope === "chapter" && activeChapter ? activeChapter : report?.manuscript;
  const words = scoped?.words ?? [];
  const phrases = scoped?.phrases ?? [];
  const wordsAnalyzed = scoped?.wordsAnalyzed ?? 0;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer search-panel" role="dialog" aria-label="Repetition">
        <DrawerHead title="Repetition" onClose={onClose} />
        <p className="scratch-hint">
          Words and phrases used above a normal rate, ignoring stop words and character names. Ciciro
          never edits prose for you - use it to decide what to vary.
        </p>

        {error && (
          <div className="scratch-error" role="alert">
            {error}
          </div>
        )}

        <div className="search-options">
          <button
            className={`btn small ${effectiveScope === "chapter" ? "primary" : "ghost"}`}
            disabled={!activeChapter}
            onClick={() => setScope("chapter")}
          >
            This chapter
          </button>
          <button
            className={`btn small ${effectiveScope === "manuscript" ? "primary" : "ghost"}`}
            onClick={() => setScope("manuscript")}
          >
            Whole manuscript
          </button>
        </div>

        <div className="search-summary" aria-live="polite">
          {loading
            ? "Checking for repetition…"
            : `${wordsAnalyzed.toLocaleString()} words analyzed${
                effectiveScope === "chapter" && activeChapter ? ` in "${activeChapter.chapterTitle || "Untitled Chapter"}"` : ""
              }`}
        </div>

        <div className="search-results">
          {loading && (
            <div role="status" aria-label="Checking for repetition">
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton short" />
            </div>
          )}
          {!loading && words.length === 0 && phrases.length === 0 && (
            <div className="empty">Nothing stands out above the usual rate.</div>
          )}
          {!loading && (
            <>
              <FlagSection title="Overused words" flags={words} onInspect={onInspect} />
              <FlagSection title="Overused phrases" flags={phrases} onInspect={onInspect} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
