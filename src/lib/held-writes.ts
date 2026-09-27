// Writes into the editor that arrive while it cannot take them (a chapter held
// for its Undo, or an editor still mounting) wait here, in order, and land once
// that chapter's editor is ready again. Dictated or drafted words are never
// dropped on the floor.

export type HeldWritesDeps<H> = {
  /** True while the chapter must not be written to. */
  isHeld: (chapterId: string) => boolean;
  /** The ready editor for this chapter, or null when it is not the one showing or not mounted yet. */
  target: (chapterId: string) => H | null;
};

export function createHeldWrites<H>(deps: HeldWritesDeps<H>) {
  const queue: Array<{ chapterId: string; write: (editor: H) => void }> = [];

  const open = (chapterId: string) => (deps.isHeld(chapterId) ? null : deps.target(chapterId));

  return {
    /** Write now if the chapter's editor can take it, else once it can. */
    write(chapterId: string, write: (editor: H) => void) {
      const editor = queue.some((q) => q.chapterId === chapterId) ? null : open(chapterId);
      if (editor) write(editor);
      else queue.push({ chapterId, write });
    },
    /** Land every waiting write whose chapter's editor can take it now. */
    flush() {
      for (let i = 0; i < queue.length; ) {
        const editor = open(queue[i].chapterId);
        if (!editor) {
          i += 1;
          continue;
        }
        const [{ write }] = queue.splice(i, 1);
        write(editor);
      }
    },
    /** Writes still waiting. */
    get size() {
      return queue.length;
    },
  };
}
