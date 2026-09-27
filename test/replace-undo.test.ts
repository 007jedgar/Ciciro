import { describe, expect, it } from "vitest";
import { makeReplaceUndo, type ReplaceUndoDeps, type ReplaceUndoResult } from "@/lib/replace-undo";
import { saveChapter, type SaveHint } from "@/lib/chapter-save";
import { OptimisticChapterStore, type SavePayload } from "@/lib/optimistic-chapter";
import type { Chapter } from "@/lib/types";
import { undoMessage } from "@/components/SearchPanel";

// A tiny stand-in for the workspace: a server with chapters at a revision, the
// writer's copy, and the save queue. A restore's save lands unless the chapter
// is failing (network) or another device has moved it on (409).
function workspace(over: Partial<ReplaceUndoDeps> = {}) {
  const revisions = new Map<string, number>([
    ["c1", 4],
    ["c2", 7],
  ]);
  const server = new Map<string, string>();
  const local = new Map<string, string>();
  const restored: Array<[string, string]> = [];
  const shown: string[][] = [];
  const failing = new Set<string>();
  const elsewhere = new Map<string, string>();
  const deps: ReplaceUndoDeps = {
    flushSaves: async () => true,
    currentRevision: (id) => revisions.get(id),
    restore: async (id, content) => {
      restored.push([id, content]);
      local.set(id, content);
      await Promise.resolve();
      if (failing.has(id)) return "failed";
      const other = elsewhere.get(id);
      if (other !== undefined) {
        server.set(id, other);
        local.set(id, other);
        revisions.set(id, (revisions.get(id) ?? 0) + 2);
        return "conflict";
      }
      server.set(id, content);
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
      return "saved";
    },
    show: (ids) => shown.push(ids),
    ...over,
  };
  return { revisions, server, local, restored, shown, deps, failing, elsewhere };
}

const before = [
  { id: "c1", content: "<p>old one</p>", revision: 4 },
  { id: "c2", content: "<p>old two</p>", revision: 7 },
];

describe("undoing a replace", () => {
  it("puts every chapter back when nothing has been written since", async () => {
    const w = workspace();
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 2, total: 2, changed: 0, failed: 0, overwritten: 0 });
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
    expect(result).toEqual({ restored: 1, total: 2, changed: 1, failed: 0, overwritten: 0 });
  });

  it("does nothing, and says why, when the writer's edits cannot be saved", async () => {
    const w = workspace({ flushSaves: async () => false });
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 0, total: 2, changed: 0, failed: 0, overwritten: 0, blocked: "unsaved" });
    expect(w.restored).toEqual([]);
    expect(w.shown).toEqual([]);
    expect(undoMessage(result)).toMatch(/haven't saved/);
  });

  it("skips a chapter whose old text was not known", async () => {
    const w = workspace();
    const result = await makeReplaceUndo([{ id: "c1", content: null, revision: 4 }, before[1]], w.deps)();
    expect(w.restored).toEqual([["c2", "<p>old two</p>"]]);
    expect(result).toEqual({ restored: 1, total: 2, changed: 1, failed: 0, overwritten: 0 });
  });

  it("counts a restore whose save failed as failed, and shows every chapter it touched, rolled back or not", async () => {
    const w = workspace();
    w.failing.add("c1");
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 1, total: 2, changed: 0, failed: 1, overwritten: 0 });
    expect(w.shown).toEqual([["c1", "c2"], ["c1"]]);
    expect(undoMessage(result)).toBe("Restored 1 of 2 chapters: 1 couldn't be saved.");
  });

  it("counts a restore refused because another device wrote to the chapter as changed, though the revision moved", async () => {
    const w = workspace();
    // The phone saved c1 after the replace; this device's copy never heard, so
    // the restore goes out on revision 4 and the server answers 409.
    w.elsewhere.set("c1", "<p>from the phone</p>");
    const result = await makeReplaceUndo(before, w.deps)();
    expect(w.revisions.get("c1")).not.toBe(4);
    expect(w.local.get("c1")).toBe("<p>from the phone</p>");
    expect(result).toEqual({ restored: 1, total: 2, changed: 1, failed: 0, overwritten: 0 });
    expect(w.shown).toEqual([["c1", "c2"], ["c1"]]);
    expect(undoMessage(result)).toBe("Restored 1 of 2 chapters: 1 edited since and left as it is.");
  });

  it("shows the old text before its save lands, so typing meanwhile builds on it", async () => {
    const w = workspace();
    let land!: () => void;
    const landed = new Promise<void>((resolve) => (land = resolve));
    const save = w.deps.restore;
    w.deps.restore = async (id, content) => {
      await landed;
      return save(id, content);
    };
    const undo = makeReplaceUndo(before, w.deps)();
    await Promise.resolve();
    expect(w.shown).toEqual([["c1", "c2"]]);
    land();
    expect(await undo).toEqual({ restored: 2, total: 2, changed: 0, failed: 0, overwritten: 0 });
  });
});

// The real save path against a fake server: Replace all moved c1 to revision 5,
// then the phone saved its own edit at revision 6 before this device's Undo.
function realSave() {
  const chapter = (content: string, revision: number): Chapter => ({
    id: "c1",
    projectId: "p1",
    title: "One",
    order: 0,
    content,
    summary: "",
    status: "draft",
    wordCount: 2,
    revision,
  });
  const server = { content: "<p>from the phone</p>", revision: 6 };
  const store = new OptimisticChapterStore();
  store.init([chapter("<p>new one</p>", 5)]);
  const local = { content: "<p>new one</p>", title: "One", status: "draft" };
  const hints: SaveHint[] = [];
  const shown: string[][] = [];
  let typing: string | null = null;
  const send = async (_id: string, body: SavePayload & { expectedRevision: number }) => {
    // The writer types into the restored text while the PATCH is in flight.
    if (typing !== null) {
      local.content = typing;
      typing = null;
    }
    if (body.expectedRevision !== server.revision) {
      return new Response(JSON.stringify({ chapter: chapter(server.content, server.revision) }), { status: 409 });
    }
    server.content = body.content ?? server.content;
    server.revision += 1;
    return new Response(JSON.stringify(chapter(server.content, server.revision)));
  };
  const deps: ReplaceUndoDeps = {
    flushSaves: async () => true,
    currentRevision: (id) => store.getExpectedRevision(id),
    restore: async (id, content) => {
      local.content = content;
      const { outcome } = await saveChapter(
        {
          store,
          send,
          getLocalFields: () => ({ ...local }),
          updateChapterLocal: (_id, patch) => Object.assign(local, patch),
          showHint: (hint) => hints.push(hint),
        },
        id,
        { content }
      );
      return outcome;
    },
    show: (ids) => shown.push(ids),
  };
  const typeWhileSaving = (html: string) => {
    typing = html;
  };
  return { server, local, hints, shown, deps, typeWhileSaving };
}

describe("undoing a replace on the real save path", () => {
  const prior = [{ id: "c1", content: "<p>old one</p>", revision: 5 }];

  it("leaves another device's edit alone and shows it when the writer did not type", async () => {
    const w = realSave();
    const result = await makeReplaceUndo(prior, w.deps)();
    expect(result).toEqual({ restored: 0, total: 1, changed: 1, failed: 0, overwritten: 0 });
    expect(w.server.content).toBe("<p>from the phone</p>");
    expect(w.local.content).toBe("<p>from the phone</p>");
    expect(w.shown).toEqual([["c1"], ["c1"]]);
    expect(undoMessage(result)).toBe("Couldn't undo: the chapter changed since.");
  });

  it("keeps typing that raced a 409, says it was saved over the other device, and never calls the chapter left alone", async () => {
    const w = realSave();
    w.typeWhileSaving("<p>old one</p><p>typed</p>");
    const result = await makeReplaceUndo(prior, w.deps)();
    expect(result).toEqual({ restored: 0, total: 1, changed: 0, failed: 0, overwritten: 1 });
    expect(w.server.content).toBe("<p>old one</p><p>typed</p>");
    expect(w.local.content).toBe("<p>old one</p><p>typed</p>");
    expect(w.hints).toContain("overwrote");
    // The editor already holds the typing; it is not remounted out from under it.
    expect(w.shown).toEqual([["c1"]]);
    const message = undoMessage(result);
    expect(message).toBe(
      "Couldn't undo: 1 changed on another device while you typed, and your version was saved over it."
    );
    expect(message).not.toMatch(/left as it is/);
  });
});

describe("undoMessage", () => {
  const result = (over: Partial<ReplaceUndoResult>): ReplaceUndoResult => ({
    restored: 0,
    total: 1,
    changed: 0,
    failed: 0,
    overwritten: 0,
    ...over,
  });

  it("is silent when everything came back", () => {
    expect(undoMessage(result({ restored: 2, total: 2 }))).toBeNull();
  });

  it("says a chapter was edited since when that is the only reason", () => {
    expect(undoMessage(result({ changed: 1 }))).toBe("Couldn't undo: the chapter changed since.");
  });

  it("pluralises when every chapter was edited since", () => {
    expect(undoMessage(result({ total: 3, changed: 3 }))).toBe("Couldn't undo: the chapters changed since.");
  });

  it("words a save failure apart from 'changed since'", () => {
    const message = undoMessage(result({ failed: 1, overwritten: 0 }));
    expect(message).toBe("Couldn't undo: the chapter couldn't be saved. Check your connection and try again.");
    expect(message).not.toMatch(/changed since/);
  });

  it("names a chapter saved over another device's edit apart from one left alone", () => {
    expect(undoMessage(result({ restored: 1, total: 3, changed: 1, overwritten: 1 }))).toBe(
      "Restored 1 of 3 chapters: 1 edited since and left as it is; 1 changed on another device while you typed, and your version was saved over it."
    );
  });

  it("counts each kind of miss when only some chapters came back", () => {
    expect(undoMessage(result({ restored: 1, total: 3, changed: 1, failed: 1, overwritten: 0 }))).toBe(
      "Restored 1 of 3 chapters: 1 edited since and left as it is; 1 couldn't be saved."
    );
    expect(undoMessage(result({ restored: 1, total: 3, changed: 2 }))).toBe(
      "Restored 1 of 3 chapters: 2 edited since and left as they are."
    );
    expect(undoMessage(result({ restored: 2, total: 3, failed: 1, overwritten: 0 }))).toBe(
      "Restored 2 of 3 chapters: 1 couldn't be saved."
    );
  });

  it("says when the writer's own edits blocked the undo", () => {
    expect(undoMessage(result({ blocked: "unsaved" }))).toMatch(/haven't saved/);
  });
});
