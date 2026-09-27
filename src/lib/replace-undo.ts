import type { SaveOutcome } from "@/lib/optimistic-chapter";

// Taking back a Replace all. The replace rewrote whole chapters on the server,
// so Undo puts the old text back, but only into chapters nobody has written to
// since: the writer's newer words always win over an Undo.

export type ReplaceUndoResult = {
  /** Chapters put back and saved. */
  restored: number;
  /** Chapters the replace rewrote. */
  total: number;
  /** Left alone because the writer, here or on another device, wrote to them since the replace. */
  changed: number;
  /** Put back locally but not saved (a network or server failure). */
  failed: number;
  /** Nothing was attempted: the writer's own edits could not be saved first. */
  blocked?: "unsaved";
};

export type ReplacedBefore = {
  id: string;
  /** What the chapter said before the replace; null when it was not known. */
  content: string | null;
  /** The revision the replace left the chapter at. */
  revision: number;
};

export type { SaveOutcome };

export type ReplaceUndoDeps = {
  /** Land anything typed and queued. Resolves false if some of it could not be saved. */
  flushSaves: () => Promise<boolean>;
  /** The revision the writer's copy of the chapter is confirmed at. */
  currentRevision: (id: string) => number | null | undefined;
  /** Save the old text through the save queue; the writer's copy changes only once the server has answered. */
  restore: (id: string, content: string) => Promise<SaveOutcome>;
  /** Keep these chapters from being edited while their restore is in flight. Returns the release. */
  hold: (ids: string[]) => () => void;
  /** Show these chapters' current text in the editor. */
  show: (ids: string[]) => void;
};

export function makeReplaceUndo(before: readonly ReplacedBefore[], deps: ReplaceUndoDeps) {
  return async (): Promise<ReplaceUndoResult> => {
    const total = before.length;
    // The editor holds typing back for a moment before saving it; land it, so
    // the revisions below say whether the writer has touched a chapter since.
    if (!(await deps.flushSaves())) return { restored: 0, total, changed: 0, failed: 0, blocked: "unsaved" };
    const untouched = before.filter(
      (prior) => prior.content !== null && deps.currentRevision(prior.id) === prior.revision
    );
    if (untouched.length === 0) return { restored: 0, total, changed: total, failed: 0 };
    // Nothing can be typed into a chapter while its restore is in flight, so
    // the server's answer is the whole story: nothing to merge, nothing written
    // over another device's newer copy.
    const release = deps.hold(untouched.map((prior) => prior.id));
    let outcomes: SaveOutcome[];
    try {
      outcomes = await Promise.all(untouched.map((prior) => deps.restore(prior.id, prior.content as string)));
      // A landed restore holds the old text and a conflict holds the server's
      // newer copy; a failed one is as it was, so it needs no fresh editor.
      const changedHere = untouched
        .filter((_, i) => outcomes[i] !== "failed")
        .map((prior) => prior.id);
      if (changedHere.length > 0) deps.show(changedHere);
    } finally {
      release();
    }
    const count = (outcome: SaveOutcome) => outcomes.filter((o) => o === outcome).length;
    return {
      restored: count("saved"),
      total,
      changed: total - untouched.length + count("conflict"),
      failed: count("failed"),
    };
  };
}
