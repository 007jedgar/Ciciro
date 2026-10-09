import { useEffect, useMemo } from "react";
import { useManuscriptTargetQuery, useWritingDaysQuery } from "./api";
import { markDeadlineCelebrated, hasCelebratedDeadline } from "./celebrations";
import { addDays, deadlineSnapshot, PACE_WINDOW_DAYS, type DeadlineSnapshot } from "./deadline-pace";
import { getAnalytics } from "./analytics-client";
import * as haptics from "./haptics";
import { useProject } from "./project";
import { useSession } from "./session";
import { writingDayKey } from "./writing-day";

export type DeadlineState = {
  /** Null until the server has answered, so nothing shows a number about to change. */
  loaded: boolean;
  /** The saved target, or null when this manuscript has no deadline. */
  target: { wordGoal: number; deadline: string } | null;
  /** How the deadline stands; null with no target. */
  snapshot: DeadlineSnapshot | null;
  /** Words in the manuscript right now, the phone's copy where it is newer than the server's. */
  manuscriptWords: number;
  error: boolean;
  refetch: () => void;
};

/**
 * A manuscript's deadline and how it is going, for the chapters card and the
 * deadline screen. Words come from the open manuscript (so what was just typed
 * counts) and fall back to the server's total; the pace comes from the author's
 * writing days over the last two weeks. Meeting the target plays the goal-met
 * moment once, here, whichever of the two is on screen first.
 */
export function useDeadline(projectId: string): DeadlineState {
  const { user } = useSession();
  const { project } = useProject();
  const query = useManuscriptTargetQuery(projectId, { enabled: Boolean(user) });
  const today = writingDayKey();
  const days = useWritingDaysQuery(addDays(today, -PACE_WINDOW_DAYS), today, { enabled: Boolean(user) });

  const target = query.data?.target ?? null;
  const manuscriptWords = project
    ? project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
    : (target?.manuscriptWords ?? 0);

  const snapshot = useMemo(
    () =>
      target
        ? deadlineSnapshot({
            wordGoal: target.wordGoal,
            deadline: target.deadline,
            manuscriptWords,
            days: days.data?.days ?? [],
            today,
          })
        : null,
    [target, manuscriptWords, days.data?.days, today]
  );

  const userId = user?.id;
  const complete = snapshot?.status === "complete";
  const wordGoal = target?.wordGoal;
  useEffect(() => {
    if (!userId || !complete || wordGoal === undefined) return;
    if (hasCelebratedDeadline(userId, projectId, wordGoal)) return;
    markDeadlineCelebrated(userId, projectId, wordGoal);
    haptics.celebrate();
    getAnalytics().track("deadline_met", {});
  }, [userId, projectId, complete, wordGoal]);

  return {
    loaded: query.isSuccess && (!target || days.isSuccess || days.isError),
    target: target ? { wordGoal: target.wordGoal, deadline: target.deadline } : null,
    snapshot,
    manuscriptWords,
    error: query.isError,
    refetch: () => void query.refetch(),
  };
}
