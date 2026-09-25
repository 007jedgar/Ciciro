"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WordDiff } from "@/components/DiffView";
import { htmlToText } from "@/lib/text";
import {
  diffStats,
  formatSnapshotTime,
  SNAPSHOT_LABEL_MAX,
  snapshotDiff,
  snapshotTitle,
  type ChapterSnapshotDetail,
  type ChapterSnapshotSummary,
} from "@/lib/snapshot-view";
import type { Chapter } from "@/lib/types";

type Props = {
  chapterId: string;
  /** The chapter as the author sees it now, for the comparison. */
  currentContent: string;
  /** Bump to refetch, e.g. after an editor turn that may have left a snapshot. */
  refreshToken?: number;
  /** Lands any unsaved typing, so a snapshot or restore sees the latest text. */
  beforeWrite: () => Promise<void>;
  onRestored: (chapter: Chapter) => void;
};

type RestoreResponse = {
  chapter: Chapter;
  restored: ChapterSnapshotSummary;
  backup: ChapterSnapshotSummary | null;
};

type Notice = { kind: "restored"; title: string; undoId: string | null } | { kind: "undone" };

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

function wordsLabel(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;
}

function restoreSummary(stats: { added: number; removed: number }): string {
  const changes = [
    stats.added > 0 ? `brings back ${wordsLabel(stats.added)}` : "",
    stats.removed > 0 ? `removes ${wordsLabel(stats.removed)}` : "",
  ].filter(Boolean);
  if (changes.length === 0) return "Same as the current text.";
  return `Restoring ${changes.join(" and ")}.`;
}

export default function ChapterHistory({
  chapterId,
  currentContent,
  refreshToken,
  beforeWrite,
  onRestored,
}: Props) {
  const [snapshots, setSnapshots] = useState<ChapterSnapshotSummary[] | null>(null);
  const [details, setDetails] = useState<Record<string, ChapterSnapshotDetail>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"changes" | "text">("changes");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<"save" | "restore" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/chapters/${chapterId}/snapshots`);
    if (!res.ok) throw new Error(await readError(res, "Couldn't load this chapter's history."));
    const body = (await res.json()) as { snapshots: ChapterSnapshotSummary[] };
    setSnapshots(body.snapshots);
  }, [chapterId]);

  useEffect(() => {
    setSnapshots(null);
    setDetails({});
    setSelectedId(null);
    setNotice(null);
    setError(null);
  }, [chapterId]);

  useEffect(() => {
    let cancelled = false;
    load().catch((e: Error) => {
      if (cancelled) return;
      setSnapshots((s) => s ?? []);
      setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [load, refreshToken]);

  useEffect(() => {
    if (!selectedId || details[selectedId]) return;
    let cancelled = false;
    fetch(`/api/chapters/${chapterId}/snapshots/${selectedId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, "Couldn't open that version."));
        return (await res.json()) as ChapterSnapshotDetail;
      })
      .then((detail) => {
        if (!cancelled) setDetails((d) => ({ ...d, [detail.id]: detail }));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [chapterId, selectedId, details]);

  const selected = selectedId ? details[selectedId] ?? null : null;

  // Read as "what restoring would do": struck words go, highlighted come back.
  const parts = useMemo(
    () => (selected ? snapshotDiff(currentContent, selected.content) : []),
    [selected, currentContent]
  );
  const stats = useMemo(() => diffStats(parts), [parts]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    try {
      await beforeWrite();
      const res = await fetch(`/api/chapters/${chapterId}/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't save a snapshot."));
      setLabel("");
      setNotice(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function restore(snapshot: ChapterSnapshotSummary, undo = false) {
    setBusy("restore");
    setError(null);
    try {
      await beforeWrite();
      const res = await fetch(`/api/chapters/${chapterId}/snapshots/${snapshot.id}/restore`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't restore that version."));
      const result = (await res.json()) as RestoreResponse;
      onRestored(result.chapter);
      setNotice(
        undo
          ? { kind: "undone" }
          : {
              kind: "restored",
              title: snapshotTitle(result.restored),
              undoId: result.backup?.id ?? null,
            }
      );
      setSelectedId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(snapshot: ChapterSnapshotSummary) {
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/snapshots/${snapshot.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't delete that version."));
      setSelectedId(null);
      if (notice?.kind === "restored" && notice.undoId === snapshot.id) setNotice(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="history">
      <form className="history-save" onSubmit={save}>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name this version (optional)"
          maxLength={SNAPSHOT_LABEL_MAX}
          aria-label="Snapshot name"
          disabled={busy !== null}
        />
        <button className="btn small primary" type="submit" disabled={busy !== null}>
          {busy === "save" ? "Saving..." : "Save snapshot"}
        </button>
      </form>
      <p className="history-hint">
        Ciciro also keeps a copy before it edits this chapter, when you return to it after a
        break, and before every restore.
      </p>

      {notice?.kind === "undone" && (
        <div className="history-notice" role="status">
          <span>Restore undone. The chapter is back the way it was.</span>
        </div>
      )}
      {notice?.kind === "restored" && (
        <div className="history-notice" role="status">
          <span>
            Restored &ldquo;{notice.title}&rdquo;.
            {notice.undoId ? " The text it replaced is saved in the list below." : ""}
          </span>
          {notice.undoId && (
            <button
              className="btn small"
              disabled={busy !== null}
              onClick={() => {
                const backup = snapshots?.find((s) => s.id === notice.undoId);
                if (backup) void restore(backup, true);
              }}
            >
              Undo restore
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="history-error" role="alert">
          {error}
        </div>
      )}

      {snapshots === null ? (
        <div className="diff-empty">Loading history...</div>
      ) : snapshots.length === 0 ? (
        <div className="diff-empty">
          No versions yet. Save a snapshot to keep this draft, or keep writing - one is kept
          automatically before Ciciro edits the chapter.
        </div>
      ) : (
        <ul className="history-list">
          {snapshots.map((snapshot) => {
            const open = snapshot.id === selectedId;
            return (
              <li key={snapshot.id} className={`history-item${open ? " open" : ""}`}>
                <button
                  className="history-row"
                  aria-expanded={open}
                  onClick={() => {
                    setSelectedId(open ? null : snapshot.id);
                    setMode("changes");
                  }}
                >
                  <span className="history-row-title">{snapshotTitle(snapshot)}</span>
                  <span className="history-row-meta">
                    {formatSnapshotTime(snapshot.createdAt)} - {wordsLabel(snapshot.wordCount)}
                  </span>
                </button>
                {open && (
                  <div className="history-preview">
                    <div className="history-preview-bar">
                      <div className="view-toggle">
                        <button
                          className={`btn small ${mode === "changes" ? "primary" : "ghost"}`}
                          onClick={() => setMode("changes")}
                        >
                          Changes
                        </button>
                        <button
                          className={`btn small ${mode === "text" ? "primary" : "ghost"}`}
                          onClick={() => setMode("text")}
                        >
                          Full text
                        </button>
                      </div>
                      <span style={{ flex: 1 }} />
                      <button
                        className="btn small ghost"
                        disabled={busy !== null}
                        onClick={() => void remove(snapshot)}
                      >
                        Delete
                      </button>
                      <button
                        className="btn small primary"
                        disabled={busy !== null || !selected}
                        onClick={() => void restore(snapshot)}
                      >
                        {busy === "restore" ? "Restoring..." : "Restore this version"}
                      </button>
                    </div>
                    {!selected ? (
                      <div className="diff-empty">Loading version...</div>
                    ) : mode === "changes" ? (
                      <>
                        <div className="history-diff-summary">
                          {restoreSummary(stats)}
                        </div>
                        <div className="diff-hunk-body history-body">
                          <WordDiff parts={parts} />
                        </div>
                      </>
                    ) : (
                      <div className="diff-hunk-body history-body">
                        {htmlToText(selected.content) || "This version is empty."}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
