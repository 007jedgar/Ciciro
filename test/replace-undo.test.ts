import { describe, expect, it, vi } from "vitest";
import { makeReplaceUndo, type ReplaceUndoDeps, type ReplaceUndoResult } from "@/lib/replace-undo";
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
  // The server moves a chapter to a new revision when a restore lands; a failed
  // save leaves the revision where it was.
  const failing = new Set<string>();
  const deps: ReplaceUndoDeps = {
    flushSaves: async () => true,
    currentRevision: (id) => revisions.get(id),
    restore: (id, content) => {
      restored.push([id, content]);
      if (!failing.has(id)) revisions.set(id, (revisions.get(id) ?? 0) + 1);
    },
    isSaved: () => true,
    onRestored: (ids) => shown.push(ids),
    ...over,
  };
  return { revisions, restored, shown, deps, failing };
}

const before = [
  { id: "c1", content: "<p>old one</p>", revision: 4 },
  { id: "c2", content: "<p>old two</p>", revision: 7 },
];

describe("undoing a replace", () => {
  it("puts every chapter back when nothing has been written since", async () => {
    const w = workspace();
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 2, total: 2, changed: 0, failed: 0 });
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
    expect(result).toEqual({ restored: 1, total: 2, changed: 1, failed: 0 });
  });

  it("does nothing, and says why, when the writer's edits cannot be saved", async () => {
    const w = workspace({ flushSaves: async () => false });
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 0, total: 2, changed: 0, failed: 0, blocked: "unsaved" });
    expect(w.restored).toEqual([]);
    expect(w.shown).toEqual([]);
    expect(undoMessage(result)).toMatch(/haven't saved/);
  });

  it("skips a chapter whose old text was not known", async () => {
    const w = workspace();
    const result = await makeReplaceUndo([{ id: "c1", content: null, revision: 4 }, before[1]], w.deps)();
    expect(w.restored).toEqual([["c2", "<p>old two</p>"]]);
    expect(result).toEqual({ restored: 1, total: 2, changed: 1, failed: 0 });
  });

  it("does not count a restore whose save failed, even though the writer's copy rolled back to match the server", async () => {
    const w = workspace();
    w.failing.add("c1");
    // Local equals confirmed after the rollback, so isSaved says yes; only the
    // revision, which did not move, shows the old text never arrived.
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 1, total: 2, changed: 0, failed: 1 });
    expect(w.shown).toEqual([["c2"]]);
  });

  it("trusts the server's revision, not the raw HTML, when it normalises what it saved", async () => {
    const w = workspace();
    // The server keeps <p>old one</p> as its own normalised form; the text the
    // writer's copy holds differs from what was sent, which must not read as a failure.
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result.failed).toBe(0);
    expect(result.restored).toBe(2);
  });

  it("does not count a chapter that still has edits waiting to save", async () => {
    const w = workspace({ isSaved: (id) => id === "c1" });
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 1, total: 2, changed: 0, failed: 1 });
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
  const result = (over: Partial<ReplaceUndoResult>): ReplaceUndoResult => ({
    restored: 0,
    total: 1,
    changed: 0,
    failed: 0,
    ...over,
  });

  it("is silent when everything came back", () => {
    expect(undoMessage(result({ restored: 2, total: 2 }))).toBeNull();
  });

  it("says a chapter was edited since when that is the only reason", () => {
    expect(undoMessage(result({ changed: 1 }))).toBe("Couldn't undo: the chapter changed since.");
  });

  it("words a save failure apart from 'changed since'", () => {
    const message = undoMessage(result({ failed: 1 }));
    expect(message).toBe("Couldn't undo: the chapter couldn't be saved. Check your connection and try again.");
    expect(message).not.toMatch(/changed since/);
  });

  it("counts each kind of miss when only some chapters came back", () => {
    expect(undoMessage(result({ restored: 1, total: 3, changed: 1, failed: 1 }))).toBe(
      "Restored 1 of 3 chapters: 1 edited since and left as it is; 1 couldn't be saved."
    );
    expect(undoMessage(result({ restored: 1, total: 3, changed: 2 }))).toBe(
      "Restored 1 of 3 chapters: 2 edited since and left as they are."
    );
    expect(undoMessage(result({ restored: 2, total: 3, failed: 1 }))).toBe(
      "Restored 2 of 3 chapters: 1 couldn't be saved."
    );
  });

  it("says when the writer's own edits blocked the undo", () => {
    expect(undoMessage(result({ blocked: "unsaved" }))).toMatch(/haven't saved/);
  });
});
