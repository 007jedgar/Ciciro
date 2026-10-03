"use client";

import { useCallback, useEffect, useState } from "react";
import type { KnowsStance } from "@/lib/knowledge-view";

type Fact = {
  id: string;
  fact: string;
  stance: KnowsStance;
};

type Props = {
  projectId: string;
  characterPath: string;
  /** Unsaved edits in the file. Facts wait, so a save cannot overwrite the mirror. */
  dirty: boolean;
  onMirrored: () => void;
};

// Add or retire a fact from the character file. The table is the source of
// truth; the parent reloads the file so the mirror block matches.
export default function CharacterKnowledge({ projectId, characterPath, dirty, onMirrored }: Props) {
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
  }, [load]);

  async function add() {
    if (dirty || !fact.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterPath, fact: fact.trim(), stance }),
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

  async function retire(id: string) {
    if (dirty) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${id}`, { method: "DELETE" });
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
      <div className="knowledge-head">Who knows what</div>
      <p className="scratch-hint">
        What this character knows or believes. Keeping a fact here rewrites the block at the end of
        the file. Retiring one leaves it in the history of the ledger and drops it from the file.
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
          <span className="knowledge-stance">{row.stance}</span>
          <span className="knowledge-fact">{row.fact}</span>
          <button className="btn ghost small" disabled={busy || dirty} onClick={() => retire(row.id)}>
            Retire
          </button>
        </div>
      ))}
      <div className="knowledge-add">
        <select
          aria-label="Stance"
          value={stance}
          disabled={busy || dirty}
          onChange={(e) => setStance(e.target.value === "believes" ? "believes" : "knows")}
        >
          <option value="knows">knows</option>
          <option value="believes">believes</option>
        </select>
        <input
          aria-label="Fact"
          placeholder="What they know or believe"
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
