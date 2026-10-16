"use client";

import { useEffect, useState } from "react";
import DeadlineRing from "@/components/DeadlineRing";
import DrawerHead from "@/components/DrawerHead";
import { addDays, suggestedWordGoal } from "@/lib/deadline-pace";
import {
  defaultDeadlineDraft,
  dueText,
  formatCount,
  formatDueDate,
  parseWordTarget,
  progressText,
  verdictText,
  WORD_TARGET_MAX_DIGITS,
} from "@/lib/deadline-view";
import type { DeadlineState } from "@/lib/use-deadline";

type Props = {
  deadline: DeadlineState;
  /** The open manuscript's words, for the hint under the target. */
  manuscriptWords: number;
  onClose: () => void;
};

// Set, change or remove a manuscript's word target and due date, and read how it
// is going. Deterministic (no AI): the pace is src/lib/deadline-pace.ts, the same
// file the phone ships.
export default function DeadlinePanel({ deadline, manuscriptWords, onClose }: Props) {
  const { target, snapshot, today, loaded, error: loadFailed } = deadline;
  const initial = target
    ? { goal: String(target.wordGoal), date: target.deadline }
    : defaultDeadlineDraft(suggestedWordGoal(manuscriptWords), today);
  const [draft, setDraft] = useState<{ goal: string; date: string } | null>(null);
  const form = draft ?? initial;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [announcing, setAnnouncing] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A removal (or its Undo) lands a render before the form's defaults change.
  useEffect(() => {
    setDraft(null);
  }, [target?.wordGoal, target?.deadline]);

  // The save lands a render before the ring and the verdict change; say how it
  // is going once the new numbers are on screen, and only that once.
  const verdict = snapshot ? verdictText(snapshot) : "";
  useEffect(() => {
    if (!announcing || !snapshot) return;
    setAnnouncing(false);
    setSaved(`Deadline saved. ${verdict}`);
  }, [announcing, snapshot, verdict]);

  const parsedGoal = parseWordTarget(form.goal);
  const dirty = !target || form.goal !== initial.goal || form.date !== initial.date;
  const complete = snapshot?.status === "complete";

  async function save() {
    if (busy) return;
    if (parsedGoal === null) {
      setError("Enter a word target of at least 1.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      setError("Choose a due date.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await deadline.save({ wordGoal: parsedGoal, deadline: form.date });
      setDraft(null);
      setSaved("Deadline saved.");
      setAnnouncing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the deadline.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer deadline-drawer" role="dialog" aria-label="Deadline">
        <DrawerHead title="Deadline" onClose={onClose} />

        {loadFailed ? (
          <div className="scratch-error" role="alert">
            Couldn&rsquo;t load the deadline.{" "}
            <button type="button" className="btn small" onClick={deadline.refetch}>
              Try again
            </button>
          </div>
        ) : !loaded ? (
          <div role="status" aria-label="Loading the deadline">
            <span className="skeleton title" />
            <span className="skeleton" />
            <span className="skeleton short" />
          </div>
        ) : (
          <>
            {snapshot ? (
              <div className="deadline-summary" data-testid="deadline-summary">
                <DeadlineRing progress={snapshot.progress} complete={complete} size={168} strokeWidth={8} />
                <div className="deadline-headline">{complete ? "Target reached" : dueText(snapshot)}</div>
                <div className="deadline-progress">{progressText(snapshot)}</div>
                <h3 className="deadline-kicker">How it is going</h3>
                <p className="deadline-verdict" data-testid="deadline-verdict">
                  {verdict}
                </p>
              </div>
            ) : (
              <p className="scratch-hint">
                Set a due date and a word target for this manuscript. Ciciro will tell you whether you
                are on pace.
              </p>
            )}

            <form
              className="deadline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label htmlFor="deadline-target">Word target</label>
              <input
                id="deadline-target"
                inputMode="numeric"
                autoComplete="off"
                maxLength={WORD_TARGET_MAX_DIGITS + 2}
                value={form.goal}
                aria-label="Word target for the whole manuscript"
                aria-describedby="deadline-target-hint"
                onChange={(e) => {
                  setError(null);
                  setDraft({ ...form, goal: e.target.value });
                }}
              />
              <p className="scratch-hint" id="deadline-target-hint">
                The whole manuscript, when it is done. {formatCount(manuscriptWords)}{" "}
                {manuscriptWords === 1 ? "word" : "words"} written so far.
              </p>

              <label htmlFor="deadline-date">Due date</label>
              <input
                id="deadline-date"
                type="date"
                value={form.date}
                min={form.date && form.date < today ? form.date : addDays(today, 0)}
                aria-label={`Due date, ${formatDueDate(form.date)}`}
                onChange={(e) => {
                  setError(null);
                  setDraft({ ...form, date: e.target.value });
                }}
              />

              {error && (
                <div className="scratch-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="btn primary" disabled={busy || !dirty}>
                {busy ? "Saving…" : target ? "Save changes" : "Set deadline"}
              </button>
              {target && (
                <button
                  type="button"
                  className="btn ghost deadline-remove"
                  disabled={busy}
                  onClick={() => {
                    deadline.remove();
                    setError(null);
                    setSaved("");
                    setAnnouncing(false);
                  }}
                >
                  Remove deadline
                </button>
              )}
            </form>
            <div className="deadline-live" role="status" aria-live="polite">
              {saved}
            </div>
          </>
        )}
      </div>
    </>
  );
}
