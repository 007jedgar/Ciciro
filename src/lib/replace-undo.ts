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

/** What the server made of a save: kept it, refused it for an older revision, or never took it. */
export type SaveOutcome = "saved" | "conflict" | "failed";

export type ReplaceUndoDeps = {
  /** Land anything typed and queued. Resolves false if some of it could not be saved. */
  flushSaves: () => Promise<boolean>;
  /** The revision the writer's copy of the chapter is confirmed at. */
  currentRevision: (id: string) => number | null | undefined;
  /** Put the old text back through the normal save path: the local copy now, then the queued save's outcome. */
  restore: (id: string, content: string) => Promise<SaveOutcome>;
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
    const saves = untouched.map((prior) => deps.restore(prior.id, prior.content as string));
    // Show the old text before its save lands, so typing meanwhile builds on it.
    if (untouched.length > 0) deps.show(untouched.map((prior) => prior.id));
    // The server's answer decides: a conflict means another device wrote to the
    // chapter since, and comparing text would trip over the server normalising it.
    const outcomes = await Promise.all(saves);
    const missed = untouched.filter((_, i) => outcomes[i] !== "saved").map((prior) => prior.id);
    // A missed save left the writer's copy at the server's text; show that instead.
    if (missed.length > 0) deps.show(missed);
    const conflicts = outcomes.filter((o) => o === "conflict").length;
    return {
      restored: outcomes.filter((o) => o === "saved").length,
      total,
      changed: total - untouched.length + conflicts,
      failed: outcomes.filter((o) => o === "failed").length,
    };
  };
}
