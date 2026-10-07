"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DrawerHead from "@/components/DrawerHead";
import { StancePill, StanceSelect } from "@/components/KnowledgeStance";
import { getAnalytics } from "@/lib/analytics-client";
import { characterLabel, isCharacterPath, STANCE_LABELS } from "@/lib/knowledge-view";
import {
  BEFORE_STORY_ORDER,
  anchorOrder,
  byStoryOrder,
  characterTimeline,
  gridCellKey,
  knowledgeGrid,
  readerNoteFor,
  type KnowledgeStance,
  type LedgerFact,
} from "@/lib/knowledge-ledger";

type ChapterRef = { id: string; title: string; order: number };

type Fact = LedgerFact & {
  chapterId: string | null;
  supersededAtChapterId: string | null;
  sourceQuote?: string;
};

type Props = {
  projectId: string;
  /** The manuscript's live chapters. */
  chapters: ChapterRef[];
  /** The chapter open in the editor: where the scrubber starts, and where "Stops here" lands by default. */
  activeChapterId?: string | null;
  /** Pre-select one character, e.g. opened from that character's file editor. */
  initialCharacterPath?: string | null;
  onClose: () => void;
};

type View = "timeline" | "grid";

const BEFORE_STORY = "Before the story opens";

// The who-knows-what ledger, its own screen. A scrubber picks a point in the
// story; the timeline shows each character's facts in chapter order as they
// stand by the end of that chapter (holding, already over, or still to come),
// and the grid lines characters up on shared topics. Retiring a fact stops it
// at the chapter in view, so earlier chapters keep it.
export default function KnowledgeBoard({
  projectId,
  chapters,
  activeChapterId,
  initialCharacterPath,
  onClose,
}: Props) {
  const sortedChapters = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);

  const [characters, setCharacters] = useState<string[]>([]);
  const [selected, setSelected] = useState(initialCharacterPath ?? "");
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("timeline");

  // 0 is before the story opens; n is the end of chapter n.
  const [position, setPosition] = useState(() => {
    const open = sortedChapters.findIndex((c) => c.id === activeChapterId);
    return open === -1 ? sortedChapters.length : open + 1;
  });
  const scrubbed = useRef(false);
  const atChapter = position > 0 ? sortedChapters[position - 1] ?? null : null;
  const asOfOrder = atChapter ? atChapter.order : BEFORE_STORY_ORDER;

  const [addCharacter, setAddCharacter] = useState(initialCharacterPath ?? "");
  const [addStance, setAddStance] = useState<KnowledgeStance>("knows");
  const [addFact, setAddFact] = useState("");
  const [addTopic, setAddTopic] = useState("");
  // Follows the scrubber until the author picks a chapter for the new fact.
  const [addChapterChoice, setAddChapterChoice] = useState<string | null>(null);
  const addChapterId = addChapterChoice ?? atChapter?.id ?? "";

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFact, setEditFact] = useState("");
  const [editStance, setEditStance] = useState<KnowledgeStance>("knows");
  const [editChapterId, setEditChapterId] = useState("");
  const [editTopic, setEditTopic] = useState("");

  const [changingId, setChangingId] = useState<string | null>(null);
  const [changeFact, setChangeFact] = useState("");
  const [changeStance, setChangeStance] = useState<KnowledgeStance>("knows");
  const [changeTopic, setChangeTopic] = useState("");

  const [showRetired, setShowRetired] = useState<Record<string, boolean>>({});
  const [showReader, setShowReader] = useState(false);
  const [canon, setCanon] = useState<string | null>(null);

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

  const loadSeq = useRef(0);

  const loadFacts = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge?includeRetired=1`);
      const data = await res.json().catch(() => ({}));
      if (seq !== loadSeq.current) return;
      if (!res.ok) throw new Error(data.error || "Couldn't load the ledger.");
      setFacts(Array.isArray(data.facts) ? data.facts : []);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Couldn't load the ledger.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);

  useEffect(() => {
    void loadFacts();
  }, [loadFacts]);

  useEffect(() => {
    if (!addCharacter && characters.length > 0) setAddCharacter(selected || characters[0]);
  }, [characters, selected, addCharacter]);

  useEffect(() => {
    if (!showReader || canon !== null) return;
    let live = true;
    void fetch(`/api/bible?projectId=${projectId}&path=canon.md`)
      .then((res) => res.json())
      .then((data) => {
        if (live) setCanon(typeof data?.content === "string" ? data.content : "");
      })
      .catch(() => {
        if (live) setCanon("");
      });
    return () => {
      live = false;
    };
  }, [showReader, canon, projectId]);

  function scrubTo(next: number) {
    setPosition(next);
    if (!scrubbed.current) {
      scrubbed.current = true;
      getAnalytics().track("knowledge_scrubber_used", {});
    }
  }

  async function send(url: string, init: RequestInit, failure: string): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || failure);
      await loadFacts();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  async function add() {
    const characterPath = selected || addCharacter;
    if (!characterPath || !addFact.trim()) return;
    const ok = await send(
      `/api/projects/${projectId}/knowledge`,
      json("POST", {
        characterPath,
        fact: addFact.trim(),
        stance: addStance,
        topic: addTopic.trim() || null,
        chapterId: addChapterId || null,
      }),
      "Couldn't add that fact."
    );
    if (!ok) return;
    setAddFact("");
    setAddTopic("");
    setAddChapterChoice(null);
    getAnalytics().track("knowledge_fact_added", {});
  }

  async function retire(fact: Fact) {
    const stopsHere = atChapter && asOfOrder > anchorOrder(fact);
    const query = stopsHere ? `?asOf=${encodeURIComponent(atChapter.id)}` : "";
    const ok = await send(
      `/api/projects/${projectId}/knowledge/${fact.id}${query}`,
      { method: "DELETE" },
      "Couldn't retire that fact."
    );
    if (ok) getAnalytics().track("knowledge_fact_retired", {});
  }

  function startEdit(fact: Fact) {
    setChangingId(null);
    setEditingId(fact.id);
    setEditFact(fact.fact);
    setEditStance(fact.stance);
    setEditChapterId(fact.chapterId ?? "");
    setEditTopic(fact.topic ?? "");
  }

  async function saveEdit() {
    if (!editingId || !editFact.trim()) return;
    const ok = await send(
      `/api/projects/${projectId}/knowledge/${editingId}`,
      json("PATCH", {
        fact: editFact.trim(),
        stance: editStance,
        chapterId: editChapterId || null,
        topic: editTopic.trim() || null,
      }),
      "Couldn't save that fact."
    );
    if (ok) setEditingId(null);
  }

  function startChange(fact: Fact) {
    setEditingId(null);
    setChangingId(fact.id);
    setChangeFact(fact.fact);
    setChangeStance(fact.stance);
    setChangeTopic(fact.topic ?? "");
  }

  async function saveChange(fact: Fact) {
    if (!atChapter || !changeFact.trim()) return;
    const ok = await send(
      `/api/projects/${projectId}/knowledge`,
      json("POST", {
        characterPath: fact.characterPath,
        fact: changeFact.trim(),
        stance: changeStance,
        topic: changeTopic.trim() || null,
        chapterId: atChapter.id,
        replacesFactId: fact.id,
      }),
      "Couldn't record that change."
    );
    if (!ok) return;
    setChangingId(null);
    getAnalytics().track("knowledge_fact_replaced", {});
  }

  const chapterNumber = useCallback(
    (chapter: ChapterRef | null) => {
      if (!chapter) return null;
      const index = sortedChapters.findIndex((c) => c.id === chapter.id);
      return index === -1 ? null : index + 1;
    },
    [sortedChapters]
  );
  const chapterShort = (chapter: ChapterRef | null) => {
    if (!chapter) return BEFORE_STORY;
    const n = chapterNumber(chapter);
    return n ? `Ch. ${n}` : chapter.title;
  };

  const topics = useMemo(() => {
    const seen = new Map<string, string>();
    for (const fact of facts) {
      const label = fact.topic?.trim();
      if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [facts]);

  const byCharacter = useMemo(() => {
    const groups = new Map<string, Fact[]>();
    for (const fact of facts) {
      const list = groups.get(fact.characterPath) ?? [];
      list.push(fact);
      groups.set(fact.characterPath, list);
    }
    return groups;
  }, [facts]);

  const characterPaths = selected
    ? [selected]
    : [...byCharacter.keys()].sort((a, b) => characterLabel(a).localeCompare(characterLabel(b)));

  const grid = useMemo(() => knowledgeGrid(facts, asOfOrder), [facts, asOfOrder]);

  const asOfLabel = atChapter
    ? `As of the end of Ch. ${position}: ${atChapter.title}`
    : BEFORE_STORY;

  function editRow(fact: Fact) {
    return (
      <div className="kb-edit">
        <StanceSelect value={editStance} onChange={setEditStance} disabled={busy} />
        <input aria-label="Fact" value={editFact} onChange={(e) => setEditFact(e.target.value)} />
        <input
          aria-label="Topic"
          placeholder="Topic (optional)"
          list="kb-topics"
          value={editTopic}
          onChange={(e) => setEditTopic(e.target.value)}
        />
        <select aria-label="Chapter" value={editChapterId} onChange={(e) => setEditChapterId(e.target.value)}>
          <option value="">{BEFORE_STORY}</option>
          {sortedChapters.map((c, i) => (
            <option key={c.id} value={c.id}>
              {`Ch. ${i + 1}: ${c.title}`}
            </option>
          ))}
        </select>
        <button className="btn primary small" disabled={busy || !editFact.trim()} onClick={saveEdit}>
          Save
        </button>
        <button className="btn ghost small" disabled={busy} onClick={() => setEditingId(null)}>
          Cancel
        </button>
        {fact.sourceQuote ? <span className="kb-quote">&ldquo;{fact.sourceQuote}&rdquo;</span> : null}
      </div>
    );
  }

  function changeRow(fact: Fact) {
    return (
      <div className="kb-edit kb-change" aria-label="What changes here">
        <span className="kb-change-head">
          From {chapterShort(atChapter)}, {characterLabel(fact.characterPath)} now:
        </span>
        <StanceSelect value={changeStance} onChange={setChangeStance} disabled={busy} />
        <input aria-label="Fact" value={changeFact} onChange={(e) => setChangeFact(e.target.value)} />
        <input
          aria-label="Topic"
          placeholder="Topic (optional)"
          list="kb-topics"
          value={changeTopic}
          onChange={(e) => setChangeTopic(e.target.value)}
        />
        <button
          className="btn primary small"
          disabled={busy || !changeFact.trim()}
          onClick={() => saveChange(fact)}
        >
          Save change
        </button>
        <button className="btn ghost small" disabled={busy} onClick={() => setChangingId(null)}>
          Cancel
        </button>
      </div>
    );
  }

  function timelineFor(path: string) {
    const all = byCharacter.get(path) ?? [];
    const rows = characterTimeline(all, asOfOrder);
    const now = rows.filter((row) => row.state !== "later");
    const later = rows.filter((row) => row.state === "later");
    const retiredEverywhere = all
      .filter((f) => f.status !== "active" && !f.supersededAtChapter)
      .sort(byStoryOrder);
    return (
      <div key={path} className="kb-section">
        {!selected && <div className="kb-section-title">{characterLabel(path)}</div>}
        {now.length === 0 && <div className="kb-none">Nothing holds yet at this point in the story.</div>}
        <ol className="kb-timeline">
          {now.map(({ fact, state, replacedBy }) => (
            <li key={fact.id} className={`kb-row kb-${state}`}>
              {editingId === fact.id ? (
                editRow(fact)
              ) : changingId === fact.id ? (
                changeRow(fact)
              ) : (
                <>
                  <StancePill stance={fact.stance} />
                  <span className={`knowledge-fact${state === "ended" ? " kb-struck" : ""}`}>{fact.fact}</span>
                  <span className="pill">{fact.chapter ? `from ${chapterShort(fact.chapter)}` : BEFORE_STORY}</span>
                  {state === "ended" && fact.supersededAtChapter && (
                    <span className="pill">until {chapterShort(fact.supersededAtChapter)}</span>
                  )}
                  {fact.topic && <span className="pill kb-topic">{fact.topic}</span>}
                  {state === "ended" && replacedBy && (
                    <span className="kb-lineage">
                      &rarr; then {STANCE_LABELS[replacedBy.stance]}: {replacedBy.fact}
                    </span>
                  )}
                  {state === "in_effect" && (
                    <span className="kb-actions">
                      <button className="btn ghost small" disabled={busy} onClick={() => startEdit(fact)}>
                        Edit
                      </button>
                      {atChapter && asOfOrder > anchorOrder(fact) && (
                        <button
                          className="btn ghost small"
                          disabled={busy}
                          title={`Record what ${characterLabel(path)} holds instead from ${chapterShort(atChapter)}`}
                          onClick={() => startChange(fact)}
                        >
                          Changes here
                        </button>
                      )}
                      <button
                        className="btn ghost small"
                        disabled={busy}
                        title={
                          atChapter && asOfOrder > anchorOrder(fact)
                            ? `Stop this from ${chapterShort(atChapter)} on; earlier chapters keep it`
                            : "Retire this everywhere"
                        }
                        onClick={() => retire(fact)}
                      >
                        {atChapter && asOfOrder > anchorOrder(fact) ? "Stops here" : "Retire"}
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>

        {later.length > 0 && (
          <>
            <div className="kb-divider">Later in the story</div>
            <ol className="kb-timeline">
              {later.map(({ fact }) => (
                <li key={fact.id} className="kb-row kb-later">
                  {editingId === fact.id ? (
                    editRow(fact)
                  ) : (
                    <>
                      <StancePill stance={fact.stance} />
                      <span className="knowledge-fact">{fact.fact}</span>
                      <span className="pill">from {chapterShort(fact.chapter)}</span>
                      {fact.topic && <span className="pill kb-topic">{fact.topic}</span>}
                      <span className="kb-actions">
                        <button className="btn ghost small" disabled={busy} onClick={() => startEdit(fact)}>
                          Edit
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}

        {retiredEverywhere.length > 0 && (
          <div className="kb-retired">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setShowRetired((prev) => ({ ...prev, [path]: !prev[path] }))}
            >
              {showRetired[path] ? "Hide" : "Show"} retired everywhere ({retiredEverywhere.length})
            </button>
            {showRetired[path] &&
              retiredEverywhere.map((fact) => (
                <div className="kb-row kb-row-retired" key={fact.id}>
                  <StancePill stance={fact.stance} />
                  <span className="knowledge-fact kb-struck">{fact.fact}</span>
                  <span className="pill">{fact.chapter ? `from ${chapterShort(fact.chapter)}` : BEFORE_STORY}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  }

  function gridView() {
    if (grid.topics.length === 0) {
      return (
        <div className="empty">
          Give facts a topic, like &ldquo;who has the pen&rdquo;, and characters who share one line up
          here.
        </div>
      );
    }
    return (
      <div className="kb-grid-wrap">
        <table className="kb-grid">
          <thead>
            <tr>
              <th scope="col">Topic</th>
              {grid.characters.map((path) => (
                <th key={path} scope="col" className="kb-char">
                  {characterLabel(path)}
                </th>
              ))}
              {showReader && <th scope="col">Reader (canon.md)</th>}
            </tr>
          </thead>
          <tbody>
            {grid.topics.map((topic) => (
              <tr key={topic.key}>
                <th scope="row">{topic.label}</th>
                {grid.characters.map((path) => {
                  const fact = grid.cells.get(gridCellKey(topic.label, path));
                  return (
                    <td key={path}>
                      {fact ? (
                        <button
                          type="button"
                          className="kb-cell"
                          title={`${characterLabel(path)} ${STANCE_LABELS[fact.stance]}: ${fact.fact}`}
                          onClick={() => {
                            setSelected(path);
                            setView("timeline");
                          }}
                        >
                          <StancePill stance={fact.stance} />
                          <span className="kb-cell-fact">{fact.fact}</span>
                        </button>
                      ) : (
                        <span className="kb-cell-empty" aria-label="Nothing recorded">
                          &middot;
                        </span>
                      )}
                    </td>
                  );
                })}
                {showReader && (
                  <td>
                    <div className="kb-reader">
                      {canon === null ? "..." : readerNoteFor(topic.label, canon) ?? (
                        <span className="kb-cell-empty">Not in canon.md</span>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer search-panel kb-drawer" role="dialog" aria-label="Knowledge">
        <DrawerHead title="Knowledge" onClose={onClose} />
        <p className="scratch-hint">
          What each character knows, suspects, believes wrongly, or doesn&rsquo;t know, chapter by
          chapter. Slide to a chapter to see where things stand by its end.
        </p>

        <div className="kb-scrubber">
          <div className="kb-scrubber-label" aria-live="polite">
            {asOfLabel}
          </div>
          <input
            type="range"
            min={0}
            max={sortedChapters.length}
            step={1}
            value={Math.min(position, sortedChapters.length)}
            aria-label="As of chapter"
            aria-valuetext={asOfLabel}
            onChange={(e) => scrubTo(Number(e.target.value))}
            disabled={sortedChapters.length === 0}
          />
          <div className="kb-ticks" aria-hidden="true">
            <span className={position === 0 ? "on" : undefined}>&bull;</span>
            {sortedChapters.map((c, i) => (
              <span key={c.id} className={position === i + 1 ? "on" : undefined}>
                {i + 1}
              </span>
            ))}
          </div>
        </div>

        <div className="kb-toolbar">
          <div className="kb-tabs" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={view === "timeline"}
              className={`btn small ${view === "timeline" ? "primary" : "ghost"}`}
              onClick={() => setView("timeline")}
            >
              Timeline
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "grid"}
              className={`btn small ${view === "grid" ? "primary" : "ghost"}`}
              onClick={() => setView("grid")}
            >
              By topic
            </button>
          </div>
          {view === "timeline" ? (
            <select aria-label="Character" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">All characters</option>
              {characters.map((path) => (
                <option key={path} value={path}>
                  {characterLabel(path)}
                </option>
              ))}
            </select>
          ) : (
            <label className="kb-reader-toggle">
              <input type="checkbox" checked={showReader} onChange={(e) => setShowReader(e.target.checked)} />
              Reader column
            </label>
          )}
        </div>

        {error && (
          <div className="scratch-error" role="alert">
            {error}
          </div>
        )}

        <div className="search-results">
          {loading && facts.length === 0 && (
            <div role="status" aria-label="Loading the ledger">
              <span className="skeleton" />
              <span className="skeleton short" />
            </div>
          )}

          {!loading && view === "timeline" && characterPaths.length === 0 && (
            <div className="empty">
              Nothing recorded yet. Add a character from the Story Bible first, then record a fact
              below, or ask Ciciro in chat.
            </div>
          )}

          {(!loading || facts.length > 0) &&
            (view === "timeline" ? characterPaths.map((path) => timelineFor(path)) : gridView())}
        </div>

        <datalist id="kb-topics">
          {topics.map((topic) => (
            <option key={topic} value={topic} />
          ))}
        </datalist>

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
            <StanceSelect value={addStance} onChange={setAddStance} disabled={busy} />
            <input
              aria-label="Fact"
              placeholder="What they know, suspect, or have wrong"
              value={addFact}
              disabled={busy}
              onChange={(e) => setAddFact(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <input
              aria-label="Topic"
              className="kb-topic-input"
              placeholder="Topic (optional)"
              list="kb-topics"
              value={addTopic}
              disabled={busy}
              onChange={(e) => setAddTopic(e.target.value)}
            />
            <select
              aria-label="Chapter"
              value={addChapterId}
              disabled={busy}
              onChange={(e) => setAddChapterChoice(e.target.value)}
            >
              <option value="">{BEFORE_STORY}</option>
              {sortedChapters.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {`From Ch. ${i + 1}: ${c.title}`}
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
