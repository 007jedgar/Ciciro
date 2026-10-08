"use client";

import { useCallback, useEffect, useState } from "react";
import { StancePill, StanceSelect } from "@/components/KnowledgeStance";
import type { KnowsStance } from "@/lib/knowledge-view";
import { anchorOrder } from "@/lib/knowledge-ledger";

type Fact = {
  id: string;
  fact: string;
  stance: KnowsStance;
  chapter: { id: string; title: string; order: number } | null;
};

type Props = {
  projectId: string;
  characterPath: string;
  /** Unsaved edits in the file. Facts wait, so a save cannot overwrite the mirror. */
  dirty: boolean;
  onMirrored: () => void;
  /** The chapter open in the editor: new facts date from it, and retiring stops a fact there. */
  activeChapter?: { id: string; title: string; order: number } | null;
  /** Open this character in the dedicated Knowledge screen (chapter picker, edit-in-place, retired history). */
  onOpenKnowledgeScreen?: () => void;
  /** Bumped when a chat run changes the ledger, so the list refetches. */
  knowledgeChange?: number;
};

// Add or retire a fact from the character file. The table is the source of
// truth; the parent reloads the file so the mirror block matches.
export default function CharacterKnowledge({
  projectId,
  characterPath,
  dirty,
  onMirrored,
  activeChapter,
  onOpenKnowledgeScreen,
  knowledgeChange,
}: Props) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [fact, setFact] = useState("");
  const [stance, setStance] = useState<KnowsStance>("knows");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/projects/${projectId}/knowledge?characterPath=${encodeURIComponent(characterPath)}`
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.facts)) setFacts(data.facts);
  }, [projectId, characterPath]);

  useEffect(() => {
    void load();
  }, [load, knowledgeChange]);

  async function add() {
    if (dirty || !fact.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          characterPath,
          fact: fact.trim(),
          stance,
          chapterId: activeChapter?.id ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't add that fact.");
      setFact("");
      await load();
      onMirrored();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that fact.");
    } finally {
      setBusy(false);
    }
  }

  /** Stop a fact at the open chapter when it began before it; otherwise retire it everywhere. */
  function stopsAtOpenChapter(row: Fact): boolean {
    return Boolean(activeChapter && activeChapter.order > anchorOrder(row));
  }

  async function retire(row: Fact) {
    if (dirty) return;
    setBusy(true);
    setError("");
    try {
      const query = stopsAtOpenChapter(row) && activeChapter ? `?asOf=${encodeURIComponent(activeChapter.id)}` : "";
      const res = await fetch(`/api/projects/${projectId}/knowledge/${row.id}${query}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't retire that fact.");
      await load();
      onMirrored();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't retire that fact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="knowledge-box" aria-label="Who knows what">
      <div className="knowledge-head-row">
        <div className="knowledge-head">Who knows what</div>
        {onOpenKnowledgeScreen && (
          <button
            type="button"
            className="btn ghost small"
            disabled={dirty}
            title={dirty ? "Save the file before leaving it." : undefined}
            onClick={onOpenKnowledgeScreen}
          >
            Open in Knowledge screen &rarr;
          </button>
        )}
      </div>
      <p className="scratch-hint">
        What this character knows, suspects, believes wrongly, or doesn&rsquo;t know right now.
        Keeping a fact here rewrites the block at the end of the file.{" "}
        {activeChapter
          ? `New facts date from "${activeChapter.title}", the chapter you have open, and Retire stops a fact there.`
          : "With no chapter open, new facts hold from before the story opens."}{" "}
        The Knowledge screen picks any chapter and shows the story chapter by chapter.
      </p>
      {dirty && <p className="scratch-hint">Save the file before adding or retiring a fact.</p>}
      {error && (
        <div className="scratch-error" role="alert">
          {error}
        </div>
      )}
      {facts.length === 0 && <div className="empty">Nothing recorded yet.</div>}
      {facts.map((row) => (
        <div className="knowledge-row" key={row.id}>
          <StancePill stance={row.stance} />
          <span className="knowledge-fact">
            {row.fact}
            <span className="knowledge-since"> {row.chapter ? `from "${row.chapter.title}"` : "before the story"}</span>
          </span>
          <button
            className="btn ghost small"
            disabled={busy || dirty}
            title={
              stopsAtOpenChapter(row) && activeChapter
                ? `Stop this from "${activeChapter.title}" on; earlier chapters keep it`
                : "Retire this everywhere"
            }
            onClick={() => retire(row)}
          >
            Retire
          </button>
        </div>
      ))}
      <div className="knowledge-add">
        <StanceSelect value={stance} onChange={setStance} disabled={busy || dirty} />
        <input
          aria-label="Fact"
          placeholder="What they know, suspect, or have wrong"
          value={fact}
          disabled={busy || dirty}
          onChange={(e) => setFact(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button className="btn small" disabled={busy || dirty || !fact.trim()} onClick={add}>
          Add
        </button>
      </div>
    </section>
  );
}
