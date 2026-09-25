"use client";

import { useEffect, useRef, useState } from "react";

export const EXPORT_FORMATS = [
  { format: "docx", label: "Word (.docx)", hint: "Standard manuscript format" },
  { format: "epub", label: "EPUB (.epub)", hint: "For e-readers and Apple Books" },
  { format: "pdf", label: "PDF (.pdf)", hint: "Book layout with contents" },
] as const;

export default function ExportMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="export-menu-root" ref={rootRef}>
      <button
        type="button"
        className="btn small primary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Export
      </button>
      {open && (
        <div className="export-menu" role="menu" aria-label="Export manuscript">
          {EXPORT_FORMATS.map((f) => (
            <a
              key={f.format}
              role="menuitem"
              className="export-option"
              href={`/api/export/${projectId}?format=${f.format}`}
              onClick={() => setOpen(false)}
            >
              <span className="export-option-label">{f.label}</span>
              <span className="export-option-hint">{f.hint}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
