// Taking back a Replace all. The replace rewrote whole chapters on the server,
// so Undo puts the old text back, but only into chapters nobody has written to
// since: the writer's newer words always win over an Undo.

export type ReplaceUndoResult = { restored: number; total: number; blocked?: "unsaved" };

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
  /** True when the writer's copy of the chapter has nothing waiting to save. */
  isSaved: (id: string) => boolean;
  /** Chapters whose text came back, for the editor to show. */
  onRestored: (ids: string[]) => void;
};

export function makeReplaceUndo(before: readonly ReplacedBefore[], deps: ReplaceUndoDeps) {
  return async (): Promise<ReplaceUndoResult> => {
    const total = before.length;
    // The editor holds typing back for a moment before saving it; land it, so
    // the revisions below say whether the writer has touched a chapter since.
    if (!(await deps.flushSaves())) return { restored: 0, total, blocked: "unsaved" };
    const untouched = before.filter(
      (prior) => prior.content !== null && deps.currentRevision(prior.id) === prior.revision
    );
    for (const prior of untouched) deps.restore(prior.id, prior.content as string);
    await deps.flushSaves();
    const done = untouched.filter((prior) => deps.isSaved(prior.id)).map((prior) => prior.id);
    // Whatever came back is shown, even when only some of it did.
    if (done.length > 0) deps.onRestored(done);
    return { restored: done.length, total };
  };
}
