"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import BetaBadge from "@/components/BetaBadge";
import { useSnackbar } from "@/components/Snackbar";
import { downloadExport, type ExportFormat } from "@/lib/export-client";
import { getAnalytics } from "@/lib/analytics-client";
import type { ManuscriptKind } from "@/lib/manuscript-kind";
import { MOTION_MS, usePresence } from "@/lib/motion";
import { DEFAULT_SCRIPT_SETTINGS, scriptPdfSupported, type ScriptSettings } from "@/lib/screenplay";
import { SCRIPT_LANGUAGE_NOTE } from "@/lib/screenplay-view";
import { htmlWithoutSuggestions } from "@/lib/suggestions";
import { describeAiInvolvement, manuscriptAiInvolvement } from "@/lib/text";
import type { Chapter } from "@/lib/types";

type ExportOption = {
  format: ExportFormat;
  label: string;
  hint: string;
  short: string;
  /** Still in beta: marked as such. */
  beta?: boolean;
};

export const EXPORT_FORMATS: readonly ExportOption[] = [
  { format: "docx", label: "Word (.docx)", hint: "Standard manuscript format", short: "Word" },
  { format: "markdown", label: "Markdown (.md)", hint: "Plain text with formatting", short: "Markdown" },
  { format: "epub", label: "EPUB (.epub)", hint: "For e-readers and Apple Books", short: "EPUB" },
  { format: "pdf", label: "PDF (.pdf)", hint: "Book layout with contents", short: "PDF" },
];

/** A script's own formats first: its pages as a PDF, then Fountain and FDX for other tools, then the book formats. */
export const SCREENPLAY_EXPORT_FORMATS: readonly ExportOption[] = [
  { format: "pdf", label: "Screenplay PDF (.pdf)", hint: "Courier 12 pt script pages", short: "PDF", beta: true },
  { format: "fountain", label: "Fountain (.fountain)", hint: "Plain-text script for other tools", short: "Fountain", beta: true },
  { format: "fdx", label: "FDX export (.fdx)", hint: "Script as XML for other screenwriting tools", short: "FDX", beta: true },
  ...EXPORT_FORMATS.filter((f) => f.format !== "pdf"),
];

export default function ExportMenu({
  projectId,
  chapters,
  kind = "novel",
  script = DEFAULT_SCRIPT_SETTINGS,
  manuscript = { title: "", author: "" },
  beforeExport,
}: {
  projectId: string;
  chapters: Chapter[];
  kind?: ManuscriptKind;
  /** A script's own settings: its title page counts toward whether the PDF can be set. */
  script?: ScriptSettings;
  /** The manuscript's own title and author, which a blank title page falls back on. */
  manuscript?: { title: string; author: string };
  /** Settles anything the export reads from the server (a script's settings still waiting to save). */
  beforeExport?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const notify = useSnackbar();
  const { mounted, state } = usePresence(open, MOTION_MS.popoverOut);
  const [noteOpen, setNoteOpen] = useState(false);
  const screenplay = kind === "screenplay";
  const formats = screenplay ? SCREENPLAY_EXPORT_FORMATS : EXPORT_FORMATS;
  // The screenplay PDF sets Courier, so it needs a script (and a title page) in a Latin-script language (English, Spanish).
  const pdfAvailable = useMemo(
    () =>
      !screenplay ||
      !open ||
      scriptPdfSupported(
        chapters.filter((c) => !c.archivedAt).map((c) => htmlWithoutSuggestions(c.content)),
        script,
        manuscript
      ),
    [screenplay, open, chapters, script, manuscript]
  );

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
      await beforeExport?.();
      await downloadExport(projectId, format);
      setOpen(false);
      getAnalytics().track("export_completed", { format });
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
          {formats.map((f) => {
            const working = busy === f.format;
            const unavailable = screenplay && f.format === "pdf" && !pdfAvailable;
            const option = (
              <button
                key={f.format}
                type="button"
                role="menuitem"
                className="export-option"
                aria-busy={working}
                aria-describedby={unavailable && noteOpen ? "export-language-note" : undefined}
                disabled={busy !== null || unavailable}
                onClick={() => void run(f.format)}
              >
                <span className="export-option-label">
                  {working ? <span className="spinner" aria-hidden="true" /> : null}
                  {working ? `Preparing ${f.short}…` : f.label}
                  {f.beta && !working ? <BetaBadge /> : null}
                </span>
                {!working && <span className="export-option-hint">{f.hint}</span>}
              </button>
            );
            if (!unavailable) return option;
            return (
              <div key={f.format} className="export-option-row">
                {option}
                <button
                  type="button"
                  className="export-info"
                  aria-label="Why is the screenplay PDF unavailable?"
                  aria-expanded={noteOpen}
                  aria-controls="export-language-note"
                  onClick={() => setNoteOpen((v) => !v)}
                >
                  i
                </button>
                {noteOpen ? (
                  <p id="export-language-note" className="export-language-note" role="note">
                    {SCRIPT_LANGUAGE_NOTE}
                  </p>
                ) : null}
              </div>
            );
          })}
          {error ? (
            <div className="export-error" role="alert">
              {error}
            </div>
          ) : null}
          <AiInvolvementNote chapters={chapters} />
        </div>
      )}
    </div>
  );
}

/**
 * A factual self-report, not a compliance guarantee: KDP and AI-detector
 * disclosure rules are the author's to check, not Ciciro's to certify.
 */
function AiInvolvementNote({ chapters }: { chapters: Chapter[] }) {
  if (!chapters.some((c) => c.wordCount > 0)) return null;
  const involvement = manuscriptAiInvolvement(chapters);
  const since = involvement.since ? ` since ${involvement.since.toLocaleDateString()}` : "";
  return (
    <div className="export-ai-note">
      {describeAiInvolvement(involvement)}
      {since}. Each word is counted once, when written; these are running totals, not a share of
      the manuscript&rsquo;s current words, so later edits and deletions don&rsquo;t lower them,
      and activity before a chapter began tracking isn&rsquo;t included. A self-report for your
      own disclosure - not a KDP or AI-detector compliance guarantee.
    </div>
  );
}
