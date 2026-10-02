"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WordDiff } from "@/components/DiffView";
import Collapse from "@/components/Collapse";
import { useSnackbar } from "@/components/Snackbar";
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
import { getAnalytics } from "@/lib/analytics-client";

type Props = {
  chapterId: string;
  /** The chapter as the author sees it now, for the comparison. */
  currentContent: string;
  /** Bump to refetch, e.g. after an editor turn that may have left a snapshot. */
  refreshToken?: number;
  /**
   * Lands any unsaved typing, so a snapshot or restore sees the latest text.
   * Resolves false when some of it could not be saved.
   */
  beforeWrite: () => Promise<boolean>;
  onRestored: (chapter: Chapter) => void;
};

type RestoreResponse = {
  chapter: Chapter;
  restored: ChapterSnapshotSummary;
  backup: ChapterSnapshotSummary | null;
};

const UNSAVED_ERROR = "Some of your latest edits haven't saved yet. Check your connection and try again.";

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
  const notify = useSnackbar();
  // Bumped on a restore so the list and preview cross-fade to the new state.
  const [fadeKey, setFadeKey] = useState(0);

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
      if (!(await beforeWrite())) throw new Error(UNSAVED_ERROR);
      const res = await fetch(`/api/chapters/${chapterId}/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't save a snapshot."));
      setLabel("");
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
      if (!(await beforeWrite())) throw new Error(UNSAVED_ERROR);
      const res = await fetch(`/api/chapters/${chapterId}/snapshots/${snapshot.id}/restore`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't restore that version."));
      const result = (await res.json()) as RestoreResponse;
      onRestored(result.chapter);
      if (!undo) getAnalytics().track("snapshot_restored", {});
      const backup = result.backup;
      notify(
        undo
          ? { message: "Restore undone. The chapter is back the way it was." }
          : {
              message: `Restored "${snapshotTitle(result.restored)}"`,
              // The text it replaced was saved first, so taking it back is cheap.
              ...(backup
                ? { actionLabel: "Undo", onAction: () => void restore(backup, true) }
                : {}),
            }
      );
      setFadeKey((n) => n + 1);
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
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="history" key={fadeKey} data-fade={fadeKey > 0 ? "true" : undefined}>
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
                <Collapse open={open}>
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
                </Collapse>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
