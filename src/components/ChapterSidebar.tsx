"use client";

import { useRef, useState } from "react";
import type { Chapter } from "@/lib/types";
import { isChapterEmpty } from "@/lib/text";
import { IMPORT_ACCEPT } from "@/lib/import-client";

type Props = {
  chapters: Chapter[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  /** Append a Word, Markdown or Scrivener file's chapters. Throws a reader-facing Error. */
  onImport?: (file: File) => Promise<void>;
};

export default function ChapterSidebar({
  chapters,
  activeId,
  onSelect,
  onAdd,
  onDelete,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const total = chapters.reduce((s, c) => s + c.wordCount, 0);

  return (
    <div className="sidebar">
      <div className="section-head">
        <span>Chapters</span>
        <span>
          {onImport ? (
            <button
              className="btn ghost small"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              title="Import chapters from a Word, Markdown or Scrivener file"
            >
              {importing ? "Importing..." : "Import"}
            </button>
          ) : null}{" "}
          <button className="btn ghost small" onClick={onAdd} title="Add chapter">
            + Add
          </button>
        </span>
      </div>
      {onImport ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            aria-label="Import chapters from a file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setImporting(true);
              setImportError("");
              try {
                await onImport(file);
              } catch (error) {
                setImportError(error instanceof Error ? error.message : "Import failed.");
              } finally {
                setImporting(false);
              }
            }}
          />
          {importError ? (
            <div className="cm" role="alert" style={{ color: "var(--danger, #c0392b)", padding: "4px 12px" }}>
              {importError}
            </div>
          ) : null}
        </>
      ) : null}

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
            {chapters.length > 1 && isChapterEmpty(ch.content) && (
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
