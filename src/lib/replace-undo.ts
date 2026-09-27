// Taking back a Replace all. The replace rewrote whole chapters on the server,
// so Undo puts the old text back, but only into chapters nobody has written to
// since: the writer's newer words always win over an Undo.

export type ReplaceUndoResult = {
  /** Chapters put back and saved. */
  restored: number;
  /** Chapters the replace rewrote. */
  total: number;
  /** Left alone because the writer wrote to them since the replace. */
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

export type ReplaceUndoDeps = {
  /** Land anything typed and queued. Resolves false if some of it could not be saved. */
  flushSaves: () => Promise<boolean>;
  /** The revision the writer's copy of the chapter is confirmed at. */
  currentRevision: (id: string) => number | null | undefined;
  /** Put the old text back through the normal save path (local copy now, save queued). */
  restore: (id: string, content: string) => void;
  /** True when the writer's copy of the chapter has nothing waiting to save (a failed save rolls back to the confirmed copy, so this alone proves nothing). */
  isSaved: (id: string) => boolean;
  /** Chapters whose text came back, for the editor to show. */
  onRestored: (ids: string[]) => void;
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
    for (const prior of untouched) deps.restore(prior.id, prior.content as string);
    await deps.flushSaves();
    // A restore landed when the server moved the chapter past the revision the
    // replace left it at and nothing is waiting to save. The revision is the
    // server's word for it; comparing text would trip over its normalising the
    // HTML, and local-equals-confirmed also holds after a failed save rolls back.
    const done = untouched
      .filter((prior) => {
        const now = deps.currentRevision(prior.id);
        return now != null && now !== prior.revision && deps.isSaved(prior.id);
      })
      .map((prior) => prior.id);
    // Whatever came back is shown, even when only some of it did.
    if (done.length > 0) deps.onRestored(done);
    return {
      restored: done.length,
      total,
      changed: total - untouched.length,
      failed: untouched.length - done.length,
    };
  };
}
