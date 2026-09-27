import { describe, expect, it, vi } from "vitest";
import { makeReplaceUndo, type ReplaceUndoDeps } from "@/lib/replace-undo";
import { undoMessage } from "@/components/SearchPanel";

// A tiny stand-in for the workspace: chapters with a confirmed revision, text
// the writer may have typed, and the save queue's flush.
function workspace(over: Partial<ReplaceUndoDeps> = {}) {
  const revisions = new Map<string, number>([
    ["c1", 4],
    ["c2", 7],
  ]);
  const restored: Array<[string, string]> = [];
  const shown: string[][] = [];
  const deps: ReplaceUndoDeps = {
    flushSaves: async () => true,
    currentRevision: (id) => revisions.get(id),
    restore: (id, content) => restored.push([id, content]),
    isSaved: () => true,
    onRestored: (ids) => shown.push(ids),
    ...over,
  };
  return { revisions, restored, shown, deps };
}

const before = [
  { id: "c1", content: "<p>old one</p>", revision: 4 },
  { id: "c2", content: "<p>old two</p>", revision: 7 },
];

describe("undoing a replace", () => {
  it("puts every chapter back when nothing has been written since", async () => {
    const w = workspace();
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 2, total: 2 });
    expect(w.restored).toEqual([
      ["c1", "<p>old one</p>"],
      ["c2", "<p>old two</p>"],
    ]);
    expect(w.shown).toEqual([["c1", "c2"]]);
    expect(undoMessage(result)).toBeNull();
  });

  it("lands typing that is still inside the save debounce before it decides, and never overwrites it", async () => {
    const w = workspace();
    // The writer typed into c1 after the replace; the flush is what saves it,
    // which moves the chapter to a new revision.
    w.deps.flushSaves = async () => {
      w.revisions.set("c1", 5);
      return true;
    };
    const result = await makeReplaceUndo(before, w.deps)();
    expect(w.restored).toEqual([["c2", "<p>old two</p>"]]);
    expect(w.shown).toEqual([["c2"]]);
    expect(result).toEqual({ restored: 1, total: 2 });
  });

  it("does nothing, and says why, when the writer's edits cannot be saved", async () => {
    const w = workspace({ flushSaves: async () => false });
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 0, total: 2, blocked: "unsaved" });
    expect(w.restored).toEqual([]);
    expect(w.shown).toEqual([]);
    expect(undoMessage(result)).toMatch(/haven't saved/);
  });

  it("skips a chapter whose old text was not known", async () => {
    const w = workspace();
    const result = await makeReplaceUndo([{ id: "c1", content: null, revision: 4 }, before[1]], w.deps)();
    expect(w.restored).toEqual([["c2", "<p>old two</p>"]]);
    expect(result).toEqual({ restored: 1, total: 2 });
  });

  it("counts a chapter as restored only once its save has gone through", async () => {
    const w = workspace({ isSaved: (id) => id === "c1" });
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 1, total: 2 });
    expect(w.shown).toEqual([["c1"]]);
  });

  it("flushes again after queueing the restores so they have landed", async () => {
    const flush = vi.fn(async () => true);
    const w = workspace({ flushSaves: flush });
    await makeReplaceUndo(before, w.deps)();
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

describe("undoMessage", () => {
  it("says how many chapters came back when only some did", () => {
    expect(undoMessage({ restored: 1, total: 3 })).toBe(
      "Restored 1 of 3 chapters. The other 2 were edited since and left as they are."
    );
    expect(undoMessage({ restored: 1, total: 2 })).toBe(
      "Restored 1 of 2 chapters. The other one was edited since and left as they are."
    );
  });

  it("says when nothing could come back", () => {
    expect(undoMessage({ restored: 0, total: 1 })).toBe("Couldn't undo: the chapter changed since.");
  });
});
