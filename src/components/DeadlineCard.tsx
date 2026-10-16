"use client";

import DeadlineRing from "@/components/DeadlineRing";
import type { DeadlineState } from "@/lib/use-deadline";
import { dueText, progressText, statusText } from "@/lib/deadline-view";

// The manuscript's deadline at a glance, at the head of its chapters: the ring,
// when it is due, and how it is going. Nothing renders for a manuscript with no
// deadline (the Deadline item in the More menu is where one is set).
export default function DeadlineCard({ deadline, onOpen }: { deadline: DeadlineState; onOpen: () => void }) {
  const { available, snapshot, loaded } = deadline;
  if (!available || !snapshot || !loaded) return null;

  const complete = snapshot.status === "complete";
  const headline = complete ? statusText(snapshot) : dueText(snapshot);
  const progress = progressText(snapshot);
  return (
    <button
      type="button"
      className="deadline-card"
      onClick={onOpen}
      title="Open the deadline"
      aria-label={["Deadline", headline, complete ? null : statusText(snapshot), progress].filter(Boolean).join(". ")}
    >
      <DeadlineRing progress={snapshot.progress} complete={complete} size={44} strokeWidth={4} />
      <span className="deadline-card-text">
        <span className="deadline-card-title">{headline}</span>
        {!complete && <span className="deadline-card-meta">{statusText(snapshot)}</span>}
        <span className="deadline-card-meta">{progress}</span>
      </span>
    </button>
  );
}
