"use client";

import { useEffect, useRef, useState } from "react";
import { useSnackbar } from "@/components/Snackbar";
import { downloadExport, type ExportFormat } from "@/lib/export-client";
import { MOTION_MS, usePresence } from "@/lib/motion";

export const EXPORT_FORMATS = [
  { format: "docx", label: "Word (.docx)", hint: "Standard manuscript format", short: "Word" },
  { format: "markdown", label: "Markdown (.md)", hint: "Plain text with formatting", short: "Markdown" },
  { format: "epub", label: "EPUB (.epub)", hint: "For e-readers and Apple Books", short: "EPUB" },
  { format: "pdf", label: "PDF (.pdf)", hint: "Book layout with contents", short: "PDF" },
] as const;

export default function ExportMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const notify = useSnackbar();
  const { mounted, state } = usePresence(open, MOTION_MS.popoverOut);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (busyRef.current) return;
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Claim the key so focus mode, which listens on window, does not also exit.
      e.stopPropagation();
      if (!busyRef.current) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(format: ExportFormat) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(format);
    setError("");
    try {
      await downloadExport(projectId, format);
      setOpen(false);
      notify({ message: "Downloaded" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't prepare the export. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="export-menu-root" ref={rootRef}>
      <button
        type="button"
        className="btn small primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy !== null}
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        Export
      </button>
      {mounted && (
        <div className="export-menu" role="menu" aria-label="Export manuscript" data-state={state}>
          {EXPORT_FORMATS.map((f) => {
            const working = busy === f.format;
            return (
              <button
                key={f.format}
                type="button"
                role="menuitem"
                className="export-option"
                aria-busy={working}
                disabled={busy !== null}
                onClick={() => void run(f.format)}
              >
                <span className="export-option-label">
                  {working ? <span className="spinner" aria-hidden="true" /> : null}
                  {working ? `Preparing ${f.short}…` : f.label}
                </span>
                {!working && <span className="export-option-hint">{f.hint}</span>}
              </button>
            );
          })}
          {error ? (
            <div className="export-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
