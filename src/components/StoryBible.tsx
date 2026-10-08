"use client";

import { useEffect, useRef, useState } from "react";
import DrawerHead from "@/components/DrawerHead";
import CharacterKnowledge from "@/components/CharacterKnowledge";
import { getAnalytics } from "@/lib/analytics-client";

type Entry = { path: string; summary: string };

type Props = {
  projectId: string;
  onClose: () => void;
  /** Open the dedicated Knowledge screen, optionally scoped to one character. */
  onOpenKnowledge: (characterPath?: string) => void;
  /** The chapter open in the editor, for the character file's ledger box. */
  activeChapter?: { id: string; title: string; order: number } | null;
  /** Bumped when a chat run changes the ledger, so an open character file reloads its mirror block. */
  knowledgeChange?: number;
};

// The bible is now a folder of markdown files on disk. This drawer is a small
// editor over those files - the same files the editor (Opus) reads and writes.
export default function StoryBible({
  projectId,
  onClose,
  onOpenKnowledge,
  activeChapter,
  knowledgeChange,
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [newChar, setNewChar] = useState("");

  async function loadIndex() {
    const res = await fetch(`/api/bible?projectId=${projectId}`);
    const data = await res.json();
    if (Array.isArray(data)) setEntries(data);
  }

  useEffect(() => {
    loadIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function open(path: string) {
    const res = await fetch(
      `/api/bible?projectId=${projectId}&path=${encodeURIComponent(path)}`
    );
    const data = await res.json();
    setOpenPath(path);
    setContent(data.content || "");
    setSaved(true);
  }

  const seenKnowledgeChange = useRef(knowledgeChange);
  useEffect(() => {
    if (seenKnowledgeChange.current === knowledgeChange) return;
    seenKnowledgeChange.current = knowledgeChange;
    if (openPath && saved && /^characters\/[^/]+\.md$/.test(openPath)) void open(openPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeChange]);

  async function save() {
    if (!openPath) return;
    await fetch("/api/bible", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, path: openPath, content }),
    });
    setSaved(true);
    const file = openPath.replace(/\.md$/, "");
    if (file === "canon" || file === "plot" || file === "style" || file === "timeline") {
      getAnalytics().track("story_bible_edited", { file });
    }
    loadIndex();
  }

  async function addCharacter() {
    if (!newChar.trim()) return;
    const res = await fetch("/api/bible", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, newCharacter: newChar.trim() }),
    });
    const data = await res.json();
    setNewChar("");
    await loadIndex();
    if (data.path) {
      getAnalytics().track("character_created", {});
      open(data.path);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <DrawerHead title="Story Bible" onClose={onClose} />
        <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 0 }}>
          Markdown files on disk. The editor reads these to plan and writes decisions
          back to them.
        </p>

        {!openPath ? (
          <>
            <div
              className="bible-item"
              role="button"
              onClick={() => onOpenKnowledge()}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>Knowledge</div>
              <div style={{ color: "var(--ink-soft)", fontSize: 12 }}>
                Who knows what, by character, in chapter order.
              </div>
            </div>
            {entries.map((e) => (
              <div
                className="bible-item"
                key={e.path}
                role="button"
                onClick={() => open(e.path)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{e.path}</div>
                <div style={{ color: "var(--ink-soft)", fontSize: 12 }}>{e.summary}</div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <input
                placeholder="New character name"
                value={newChar}
                onChange={(e) => setNewChar(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCharacter()}
              />
              <button className="btn" onClick={addCharacter}>
                Add
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                margin: "6px 0",
              }}
            >
              <button className="btn ghost small" onClick={() => setOpenPath(null)}>
                &larr; All files
              </button>
              <strong style={{ fontSize: 13 }}>{openPath}</strong>
              <button className="btn primary small" onClick={save} disabled={saved}>
                {saved ? "Saved" : "Save"}
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setSaved(false);
              }}
              rows={26}
              style={{ fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.6 }}
            />
            {/^characters\/[^/]+\.md$/.test(openPath) && (
              <CharacterKnowledge
                projectId={projectId}
                characterPath={openPath}
                dirty={!saved}
                onMirrored={() => open(openPath)}
                activeChapter={activeChapter}
                onOpenKnowledgeScreen={() => onOpenKnowledge(openPath)}
                knowledgeChange={knowledgeChange}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
