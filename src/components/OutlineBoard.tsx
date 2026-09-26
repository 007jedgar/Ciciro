"use client";

import { useState } from "react";
import type { Chapter } from "@/lib/types";
import { chapterBlurb, moveItem } from "@/lib/outline";
import { chapterPlainText } from "@/lib/text";

type Props = {
  chapters: Chapter[];
  activeId: string | null;
  onOpen: (id: string) => void;
  /** New full order of chapter ids after a drag or a keyboard move. */
  onReorder: (ids: string[]) => void;
  onStatusChange: (id: string, status: string) => void;
  onClose: () => void;
};

type Layout = "board" | "list";

export default function OutlineBoard({
  chapters,
  activeId,
  onOpen,
  onReorder,
  onStatusChange,
  onClose,
}: Props) {
  const [layout, setLayout] = useState<Layout>("board");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = chapters.map((c) => c.id);

  function move(id: string, to: number) {
    const from = ids.indexOf(id);
    if (from < 0 || to === from || to < 0 || to >= ids.length) return;
    onReorder(moveItem(ids, from, to));
  }

  function endDrag() {
    setDragId(null);
    setOverId(null);
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="outline-panel" role="dialog" aria-label="Chapter outline">
        <div className="outline-head">
          <h2>Outline</h2>
          <span className="outline-hint">Drag a chapter to reorder, or use the arrows.</span>
          <span style={{ flex: 1 }} />
          <div className="view-toggle">
            <button
              className={`btn small ${layout === "board" ? "primary" : "ghost"}`}
              onClick={() => setLayout("board")}
            >
              Corkboard
            </button>
            <button
              className={`btn small ${layout === "list" ? "primary" : "ghost"}`}
              onClick={() => setLayout("list")}
            >
              List
            </button>
          </div>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        {chapters.length === 0 ? (
          <div className="empty">No chapters yet.</div>
        ) : (
          <div className={`outline-grid ${layout}`}>
            {chapters.map((ch, i) => (
              <div
                key={ch.id}
                className={`outline-card${ch.id === activeId ? " active" : ""}${
                  dragId === ch.id ? " dragging" : ""
                }${overId === ch.id && dragId !== ch.id ? " drop-target" : ""}`}
                draggable
                data-testid="outline-card"
                onDragStart={(e) => {
                  setDragId(ch.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", ch.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overId !== ch.id) setOverId(ch.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) move(dragId, i);
                  endDrag();
                }}
                onDragEnd={endDrag}
              >
                <div className="outline-card-top">
                  <span className="outline-num">{i + 1}</span>
                  <button
                    className="outline-title"
                    onClick={() => {
                      onOpen(ch.id);
                      onClose();
                    }}
                    title="Open this chapter"
                  >
                    {ch.title || "Untitled"}
                  </button>
                  <span className="outline-move">
                    <button
                      className="btn ghost small"
                      aria-label={`Move ${ch.title || "Untitled"} earlier`}
                      disabled={i === 0}
                      onClick={() => move(ch.id, i - 1)}
                    >
                      &uarr;
                    </button>
                    <button
                      className="btn ghost small"
                      aria-label={`Move ${ch.title || "Untitled"} later`}
                      disabled={i === chapters.length - 1}
                      onClick={() => move(ch.id, i + 1)}
                    >
                      &darr;
                    </button>
                  </span>
                </div>
                <p className="outline-blurb">
                  {chapterBlurb(ch.summary, chapterPlainText(ch.content)) || (
                    <em>Nothing written yet.</em>
                  )}
                </p>
                <div className="outline-meta">
                  <span>{ch.wordCount.toLocaleString()} words</span>
                  <select
                    value={ch.status}
                    aria-label={`Status of ${ch.title || "Untitled"}`}
                    onChange={(e) => onStatusChange(ch.id, e.target.value)}
                    style={{ width: "auto", padding: "2px 6px" }}
                  >
                    <option value="draft">draft</option>
                    <option value="revised">revised</option>
                    <option value="final">final</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
