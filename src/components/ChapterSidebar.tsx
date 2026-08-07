"use client";

import type { Chapter } from "@/lib/types";

type Props = {
  chapters: Chapter[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
};

export default function ChapterSidebar({
  chapters,
  activeId,
  onSelect,
  onAdd,
  onDelete,
}: Props) {
  const total = chapters.reduce((s, c) => s + c.wordCount, 0);

  return (
    <div className="sidebar">
      <div className="section-head">
        <span>Chapters</span>
        <button className="btn ghost small" onClick={onAdd} title="Add chapter">
          + Add
        </button>
      </div>

      {chapters.map((ch, i) => (
        <div
          key={ch.id}
          className={`chapter-item ${ch.id === activeId ? "active" : ""}`}
          onClick={() => onSelect(ch.id)}
        >
          <span className="ct">
            {i + 1}. {ch.title || "Untitled"}
          </span>
          <span className="cm">
            {ch.wordCount.toLocaleString()} words - {ch.status}
            {chapters.length > 1 && (
              <>
                {" "}
                -{" "}
                <span
                  role="button"
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${ch.title}"?`)) onDelete(ch.id);
                  }}
                >
                  delete
                </span>
              </>
            )}
          </span>
        </div>
      ))}

      <div className="section-head" style={{ marginTop: "auto" }}>
        <span>{total.toLocaleString()} words total</span>
      </div>
    </div>
  );
}
