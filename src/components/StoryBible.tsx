"use client";

import { useEffect, useState } from "react";

type Entry = { path: string; summary: string };

type Props = {
  projectId: string;
  onClose: () => void;
};

// The bible is now a folder of markdown files on disk. This drawer is a small
// editor over those files - the same files the editor (Opus) reads and writes.
export default function StoryBible({ projectId, onClose }: Props) {
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

  async function save() {
    if (!openPath) return;
    await fetch("/api/bible", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, path: openPath, content }),
    });
    setSaved(true);
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
    if (data.path) open(data.path);
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>Story Bible</h2>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 0 }}>
          Markdown files on disk. The editor reads these to plan and writes decisions
          back to them.
        </p>

        {!openPath ? (
          <>
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
          </>
        )}
      </div>
    </>
  );
}
