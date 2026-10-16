"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnackbar } from "@/components/Snackbar";
import { getAnalytics } from "@/lib/analytics-client";
import { daysBetween, deadlineSnapshot, type DeadlineSnapshot, type WritingDayWords } from "@/lib/deadline-pace";
import {
  deleteDeadlineTarget,
  fetchDeadlineDays,
  fetchDeadlineTarget,
  saveDeadlineTarget,
  type DeadlineTarget,
} from "@/lib/deadline-client";
import { writingDayKey } from "@/lib/writing-day";

export type DeadlineState = {
  /** False with no signed-in account (local single-author mode): nothing about a deadline shows. */
  available: boolean;
  /** False until the server has answered, so nothing shows a number about to change. */
  loaded: boolean;
  /** The saved target, or null when this manuscript has no deadline. */
  target: DeadlineTarget | null;
  /** How the deadline stands; null with no target. */
  snapshot: DeadlineSnapshot | null;
  /** The author's local day, YYYY-MM-DD. */
  today: string;
  /** The deadline could not be read (and there is none cached to show). */
  error: boolean;
  refetch: () => void;
  /** Rejects with a reader-facing Error. */
  save: (body: { wordGoal: number; deadline: string }) => Promise<void>;
  /** Hides the deadline at once and offers Undo; the server hears only once Undo has lapsed. */
  remove: () => void;
};

type Removal = {
  cancelled: boolean;
  /** A save is in flight, so the delete waits for it. */
  saving: boolean;
  /** The Undo window lapsed while a save was in flight. */
  lapsed: boolean;
  deleting: Promise<boolean> | null;
  commit: () => Promise<void>;
};

const metKey = (projectId: string, wordGoal: number) => `ciciro:deadline-met:${projectId}:${wordGoal}`;

/** True the first time a target is met on this device (the same once-per-target guard the phone keeps). */
function firstTimeMet(projectId: string, wordGoal: number): boolean {
  try {
    if (localStorage.getItem(metKey(projectId, wordGoal))) return false;
    localStorage.setItem(metKey(projectId, wordGoal), "1");
  } catch {
    /* storage can be blocked; the event then fires at most once per page load */
  }
  return true;
}

/**
 * A manuscript's deadline and how it is going, for the sidebar card and the
 * Deadline drawer. `manuscriptWords` is the open manuscript's live count (so
 * what was just typed counts); the pace comes from the author's writing days
 * over the last two weeks, read against whether they wrote before that.
 * `available` is false with no account to hold a deadline; nothing is fetched then.
 */
export function useDeadline(projectId: string, manuscriptWords: number, available = true): DeadlineState {
  const notify = useSnackbar();
  const [today, setToday] = useState(() => writingDayKey());
  const [target, setTarget] = useState<DeadlineTarget | null>(null);
  const [targetLoaded, setTargetLoaded] = useState(false);
  const [days, setDays] = useState<WritingDayWords[]>([]);
  const [daysLoaded, setDaysLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  /**
   * A removal still inside its Undo window or on its way to the server. A save made
   * meanwhile replaces the row, so it stops a delete that has not started and waits
   * out one that has.
   */
  const pendingRemoval = useRef<Removal | null>(null);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") setToday(writingDayKey());
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    setError(false);
    void fetchDeadlineTarget(projectId).then(
      (found) => {
        if (cancelled) return;
        setTarget(found);
        setTargetLoaded(true);
      },
      () => {
        if (!cancelled) setError(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce, available]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void fetchDeadlineDays(today)
      .catch(() => [] as WritingDayWords[])
      .then((rows) => {
        if (cancelled) return;
        setDays(rows);
        setDaysLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [today, available]);

  const snapshot = useMemo(
    () =>
      target
        ? deadlineSnapshot({
            wordGoal: target.wordGoal,
            deadline: target.deadline,
            manuscriptWords,
            days,
            today,
          })
        : null,
    [target, manuscriptWords, days, today]
  );

  const complete = snapshot?.status === "complete";
  const wordGoal = target?.wordGoal;
  useEffect(() => {
    if (!complete || wordGoal === undefined) return;
    if (firstTimeMet(projectId, wordGoal)) getAnalytics().track("deadline_met", {});
  }, [projectId, complete, wordGoal]);

  const save = useCallback(
    async (body: { wordGoal: number; deadline: string }) => {
      const removal = pendingRemoval.current;
      let created = !target;
      if (removal) {
        if (removal.deleting) {
          removal.cancelled = true;
          created = await removal.deleting;
        } else {
          removal.saving = true;
          created = false;
        }
      }
      let saved: DeadlineTarget;
      try {
        saved = await saveDeadlineTarget(projectId, body);
      } catch (e) {
        if (removal && removal.saving) {
          removal.saving = false;
          if (removal.lapsed && !removal.cancelled) void removal.commit();
        }
        throw e;
      }
      if (removal) {
        removal.saving = false;
        removal.cancelled = true;
        if (pendingRemoval.current === removal) pendingRemoval.current = null;
      }
      setTarget(saved);
      setTargetLoaded(true);
      getAnalytics().track("deadline_saved", {
        created,
        daysAhead: Math.max(0, daysBetween(today, saved.deadline)),
      });
    },
    [projectId, target, today]
  );

  const remove = useCallback(() => {
    const previous = target;
    if (!previous) return;
    const removal: Removal = {
      cancelled: false,
      saving: false,
      lapsed: false,
      deleting: null,
      commit: async () => {
        const outcome = deleteDeadlineTarget(projectId).then(
          () => null,
          (e: unknown) => (e instanceof Error ? e : new Error("Couldn't remove the deadline."))
        );
        removal.deleting = outcome.then((failure) => failure === null);
        const failure = await outcome;
        if (pendingRemoval.current === removal) pendingRemoval.current = null;
        if (!failure) {
          getAnalytics().track("deadline_removed", {});
          return;
        }
        if (removal.cancelled) return;
        setTarget(previous);
        notify({ message: failure.message });
      },
    };
    pendingRemoval.current = removal;
    setTarget(null);
    notify({
      message: "Deadline removed",
      actionLabel: "Undo",
      onAction: () => {
        if (removal.cancelled) return;
        removal.cancelled = true;
        if (pendingRemoval.current === removal) pendingRemoval.current = null;
        setTarget(previous);
      },
      onCommit: async () => {
        if (removal.cancelled) return;
        if (removal.saving) {
          removal.lapsed = true;
          return;
        }
        await removal.commit();
      },
    });
  }, [notify, projectId, target]);

  return {
    available,
    loaded: targetLoaded && (!target || daysLoaded),
    target,
    snapshot,
    today,
    error: error && !targetLoaded,
    refetch: () => setNonce((n) => n + 1),
    save,
    remove,
  };
}
