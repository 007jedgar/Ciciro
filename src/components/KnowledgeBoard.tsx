"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DrawerHead from "@/components/DrawerHead";
import { getAnalytics } from "@/lib/analytics-client";
import { characterLabel, isCharacterPath, type KnowsStance } from "@/lib/knowledge-view";

type ChapterRef = { id: string; title: string; order: number };

type Fact = {
  id: string;
  characterPath: string;
  fact: string;
  stance: KnowsStance;
  chapterId: string | null;
  chapter: ChapterRef | null;
  status: string;
};

type Props = {
  projectId: string;
  chapters: ChapterRef[];
  /** Pre-select one character, e.g. opened from that character's file editor. */
  initialCharacterPath?: string | null;
  onClose: () => void;
};

const BEFORE_STORY = "Before the story opens";

function sortFacts(facts: Fact[]): Fact[] {
  return [...facts].sort((a, b) => {
    const ao = a.chapter?.order ?? -1;
    const bo = b.chapter?.order ?? -1;
    if (ao !== bo) return ao - bo;
    return a.fact.localeCompare(b.fact);
  });
}

function groupByCharacter(facts: Fact[]): Map<string, Fact[]> {
  const groups = new Map<string, Fact[]>();
  for (const fact of facts) {
    const list = groups.get(fact.characterPath) ?? [];
    list.push(fact);
    groups.set(fact.characterPath, list);
  }
  return groups;
}

// The who-knows-what ledger, its own screen: pick a character (or see every
// character at once), each fact in chapter order with a stance badge and a
// source-chapter chip. Retired facts stay visible, struck through, below.
export default function KnowledgeBoard({ projectId, chapters, initialCharacterPath, onClose }: Props) {
  const [characters, setCharacters] = useState<string[]>([]);
  const [selected, setSelected] = useState(initialCharacterPath ?? "");
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [addCharacter, setAddCharacter] = useState(initialCharacterPath ?? "");
  const [addStance, setAddStance] = useState<KnowsStance>("knows");
  const [addFact, setAddFact] = useState("");
  const [addChapterId, setAddChapterId] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFact, setEditFact] = useState("");
  const [editStance, setEditStance] = useState<KnowsStance>("knows");
  const [editChapterId, setEditChapterId] = useState("");

  const [showRetired, setShowRetired] = useState<Record<string, boolean>>({});

  const sortedChapters = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);

  const loadCharacters = useCallback(async () => {
    const res = await fetch(`/api/bible?projectId=${projectId}`);
    const data = await res.json().catch(() => []);
    if (Array.isArray(data)) {
      setCharacters(
        data
          .map((e: { path: string }) => e.path)
          .filter((path: string) => isCharacterPath(path))
      );
    }
  }, [projectId]);

  const loadFacts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ includeRetired: "1" });
      if (selected) params.set("characterPath", selected);
      const res = await fetch(`/api/projects/${projectId}/knowledge?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't load the ledger.");
      setFacts(Array.isArray(data.facts) ? data.facts : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the ledger.");
    } finally {
      setLoading(false);
    }
  }, [projectId, selected]);

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);

  useEffect(() => {
    void loadFacts();
  }, [loadFacts]);

  useEffect(() => {
    if (!addCharacter && characters.length > 0) setAddCharacter(selected || characters[0]);
  }, [characters, selected, addCharacter]);

  async function add() {
    const characterPath = selected || addCharacter;
    if (!characterPath || !addFact.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          characterPath,
          fact: addFact.trim(),
          stance: addStance,
          chapterId: addChapterId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't add that fact.");
      setAddFact("");
      setAddChapterId("");
      await loadFacts();
      getAnalytics().track("knowledge_fact_added", {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that fact.");
    } finally {
      setBusy(false);
    }
  }

  async function retire(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't retire that fact.");
      await loadFacts();
      getAnalytics().track("knowledge_fact_retired", {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't retire that fact.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(fact: Fact) {
    setEditingId(fact.id);
    setEditFact(fact.fact);
    setEditStance(fact.stance);
    setEditChapterId(fact.chapterId ?? "");
  }

  async function saveEdit() {
    if (!editingId || !editFact.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fact: editFact.trim(),
          stance: editStance,
          chapterId: editChapterId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't save that fact.");
      setEditingId(null);
      await loadFacts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that fact.");
    } finally {
      setBusy(false);
    }
  }

  const active = facts.filter((f) => f.status === "active");
  const retired = facts.filter((f) => f.status !== "active");
  const groups = groupByCharacter(active);
  const retiredGroups = groupByCharacter(retired);
  const characterPaths = selected
    ? [selected]
    : [...new Set([...groups.keys(), ...retiredGroups.keys()])].sort((a, b) =>
        characterLabel(a).localeCompare(characterLabel(b))
      );

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer search-panel" role="dialog" aria-label="Knowledge">
        <DrawerHead title="Knowledge" onClose={onClose} />
        <p className="scratch-hint">
          What each character knows or believes, in chapter order. Facts with no chapter pin to the
          top as &ldquo;{BEFORE_STORY}&rdquo;.
        </p>

        <div className="kb-picker">
          <select
            aria-label="Character"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">All characters</option>
            {characters.map((path) => (
              <option key={path} value={path}>
                {characterLabel(path)}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="scratch-error" role="alert">
            {error}
          </div>
        )}

        <div className="search-results">
          {loading && (
            <div role="status" aria-label="Loading the ledger">
              <span className="skeleton" />
              <span className="skeleton short" />
            </div>
          )}

          {!loading && characterPaths.length === 0 && (
            <div className="empty">
              Nothing recorded yet. Add a character from the Story Bible first, then record a fact
              below.
            </div>
          )}

          {!loading &&
            characterPaths.map((path) => (
              <div key={path} className="kb-section">
                {!selected && <div className="kb-section-title">{characterLabel(path)}</div>}
                {sortFacts(groups.get(path) ?? []).map((fact) => (
                  <div className="kb-row" key={fact.id}>
                    {editingId === fact.id ? (
                      <div className="kb-edit">
                        <select
                          aria-label="Stance"
                          value={editStance}
                          onChange={(e) =>
                            setEditStance(e.target.value === "believes" ? "believes" : "knows")
                          }
                        >
                          <option value="knows">knows</option>
                          <option value="believes">believes</option>
                        </select>
                        <input
                          aria-label="Fact"
                          value={editFact}
                          onChange={(e) => setEditFact(e.target.value)}
                        />
                        <select
                          aria-label="Chapter"
                          value={editChapterId}
                          onChange={(e) => setEditChapterId(e.target.value)}
                        >
                          <option value="">{BEFORE_STORY}</option>
                          {sortedChapters.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn primary small"
                          disabled={busy || !editFact.trim()}
                          onClick={saveEdit}
                        >
                          Save
                        </button>
                        <button
                          className="btn ghost small"
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className={`pill ${fact.stance}`}>{fact.stance}</span>
                        <span className="knowledge-fact">{fact.fact}</span>
                        <span className="pill">{fact.chapter?.title ?? BEFORE_STORY}</span>
                        <button
                          className="btn ghost small"
                          disabled={busy}
                          onClick={() => startEdit(fact)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn ghost small"
                          disabled={busy}
                          onClick={() => retire(fact.id)}
                        >
                          Retire
                        </button>
                      </>
                    )}
                  </div>
                ))}

                {(retiredGroups.get(path) ?? []).length > 0 && (
                  <div className="kb-retired">
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() =>
                        setShowRetired((prev) => ({ ...prev, [path]: !prev[path] }))
                      }
                    >
                      {showRetired[path] ? "Hide" : "Show"} retired (
                      {(retiredGroups.get(path) ?? []).length})
                    </button>
                    {showRetired[path] &&
                      sortFacts(retiredGroups.get(path) ?? []).map((fact) => (
                        <div className="kb-row kb-row-retired" key={fact.id}>
                          <span className={`pill ${fact.stance}`}>{fact.stance}</span>
                          <span className="knowledge-fact kb-struck">{fact.fact}</span>
                          <span className="pill">{fact.chapter?.title ?? BEFORE_STORY}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
        </div>

        <div className="kb-add">
          <div className="knowledge-head">Add a fact</div>
          {!selected && (
            <select
              aria-label="Character"
              value={addCharacter}
              disabled={busy || characters.length === 0}
              onChange={(e) => setAddCharacter(e.target.value)}
            >
              {characters.map((path) => (
                <option key={path} value={path}>
                  {characterLabel(path)}
                </option>
              ))}
            </select>
          )}
          <div className="knowledge-add">
            <select
              aria-label="Stance"
              value={addStance}
              disabled={busy}
              onChange={(e) => setAddStance(e.target.value === "believes" ? "believes" : "knows")}
            >
              <option value="knows">knows</option>
              <option value="believes">believes</option>
            </select>
            <input
              aria-label="Fact"
              placeholder="What they know or believe"
              value={addFact}
              disabled={busy}
              onChange={(e) => setAddFact(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <select
              aria-label="Chapter"
              value={addChapterId}
              disabled={busy}
              onChange={(e) => setAddChapterId(e.target.value)}
            >
              <option value="">{BEFORE_STORY}</option>
              {sortedChapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <button
              className="btn small"
              disabled={busy || !addFact.trim() || !(selected || addCharacter)}
              onClick={add}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
