"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  replaceInManuscript,
  searchManuscript,
  type ReplacedChapter,
  type SearchMatch,
  type SearchResult,
} from "@/lib/search-client";

type Props = {
  projectId: string;
  onClose: () => void;
  /** Open the chapter at the match. */
  onJump: (match: SearchMatch, length: number) => void;
  /**
   * Save what the author has typed so a replace starts from the server's copy.
   * Resolves false when edits in the given chapter (or any chapter) are unsaved.
   */
  flushSaves: (chapterId?: string) => Promise<boolean>;
  /** Chapters the server rewrote. */
  onReplaced: (chapters: ReplacedChapter[]) => void;
};

export default function SearchPanel({ projectId, onClose, onJump, flushSaves, onReplaced }: Props) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const run = useCallback(
    async (signal?: AbortSignal) => {
      if (!query) {
        setResult(null);
        setError("");
        return;
      }
      try {
        const found = await searchManuscript(projectId, { query, matchCase, wholeWord }, signal);
        setResult(found);
        setError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
    },
    [projectId, query, matchCase, wholeWord]
  );

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setNotice("");
      void run(controller.signal);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [run]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function replace(target?: SearchMatch) {
    if (!query || busy) return;
    if (!target && result) {
      const ok = window.confirm(
        `Replace ${result.total} ${result.total === 1 ? "match" : "matches"} in ${result.chapters} ${
          result.chapters === 1 ? "chapter" : "chapters"
        }?`
      );
      if (!ok) return;
    }
    const mine = ++seq.current;
    setBusy(true);
    setError("");
    try {
      if (!(await flushSaves(target?.chapterId))) {
        throw new Error("Some edits haven't saved yet. Check your connection and try again.");
      }
      const out = await replaceInManuscript(
        projectId,
        { query, matchCase, wholeWord },
        replacement,
        target && {
          chapterId: target.chapterId,
          blockId: target.blockId,
          occurrence: target.occurrence,
          offset: target.offset,
        }
      );
      if (mine !== seq.current) return;
      onReplaced(out.chapters);
      setNotice(`Replaced ${out.replaced} ${out.replaced === 1 ? "match" : "matches"}.`);
      await run();
    } catch (e) {
      setError((e as Error).message);
      await run();
    } finally {
      setBusy(false);
    }
  }

  const groups: { chapterId: string; title: string; number: number; matches: SearchMatch[] }[] = [];
  for (const m of result?.matches ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.chapterId === m.chapterId) last.matches.push(m);
    else groups.push({ chapterId: m.chapterId, title: m.chapterTitle, number: m.chapterNumber, matches: [m] });
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer search-panel" style={{ width: 460 }} role="dialog" aria-label="Search manuscript">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>Find and replace</h2>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="search-fields">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in every chapter"
            aria-label="Find"
            maxLength={200}
          />
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="Replace with"
            aria-label="Replace with"
            maxLength={2000}
          />
        </div>
        <div className="search-options">
          <label>
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
            />
            Match case
          </label>
          <label>
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
            />
            Whole word
          </label>
          <span style={{ flex: 1 }} />
          <button
            className="btn small primary"
            disabled={busy || !result || result.total === 0}
            onClick={() => void replace()}
          >
            Replace all
          </button>
        </div>

        <div className="search-summary" aria-live="polite">
          {error
            ? error
            : notice ||
              (result
                ? result.total === 0
                  ? "No matches."
                  : `${result.total} ${result.total === 1 ? "match" : "matches"} in ${result.chapters} ${
                      result.chapters === 1 ? "chapter" : "chapters"
                    }${result.truncated ? ` (showing the first ${result.matches.length})` : ""}`
                : "Search every chapter of this manuscript.")}
        </div>

        <div className="search-results">
          {groups.map((g) => (
            <div key={g.chapterId} className="search-group">
              <div className="search-group-title">
                {g.number}. {g.title || "Untitled Chapter"}
              </div>
              {g.matches.map((m) => (
                <div className="search-hit" key={`${m.blockId}:${m.occurrence}`}>
                  <button
                    className="search-hit-text"
                    onClick={() => onJump(m, m.length)}
                    title="Jump to this match"
                  >
                    {m.before}
                    <mark>{m.match}</mark>
                    {m.after}
                  </button>
                  <button
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() => void replace(m)}
                  >
                    Replace
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
