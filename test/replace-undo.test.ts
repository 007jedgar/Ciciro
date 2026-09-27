import { describe, expect, it } from "vitest";
import { makeReplaceUndo, type ReplaceUndoDeps, type ReplaceUndoResult } from "@/lib/replace-undo";
import { restoreChapter } from "@/lib/chapter-save";
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
  const held = new Set<string>();
  const deps: ReplaceUndoDeps = {
    flushSaves: async () => true,
    currentRevision: (id) => revisions.get(id),
    restore: async (id, content) => {
      restored.push([id, content]);
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
      local.set(id, content);
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
      return "saved";
    },
    hold: (ids) => {
      for (const id of ids) held.add(id);
      return () => {
        for (const id of ids) held.delete(id);
      };
    },
    show: (ids) => shown.push(ids),
    ...over,
  };
  return { revisions, server, local, restored, shown, held, deps, failing, elsewhere };
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

  it("counts a restore whose save failed as failed and leaves that chapter's editor as it was", async () => {
    const w = workspace();
    w.failing.add("c1");
    const result = await makeReplaceUndo(before, w.deps)();
    expect(result).toEqual({ restored: 1, total: 2, changed: 0, failed: 1 });
    expect(w.local.has("c1")).toBe(false);
    expect(w.shown).toEqual([["c2"]]);
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
    expect(result).toEqual({ restored: 1, total: 2, changed: 1, failed: 0 });
    expect(w.shown).toEqual([["c1", "c2"]]);
    expect(undoMessage(result)).toBe("Restored 1 of 2 chapters: 1 edited since and left as it is.");
  });

  it("holds the chapters read-only and shows nothing until the server has answered", async () => {
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
    await Promise.resolve();
    expect([...w.held]).toEqual(["c1", "c2"]);
    expect(w.shown).toEqual([]);
    expect(w.local.size).toBe(0);
    land();
    expect(await undo).toEqual({ restored: 2, total: 2, changed: 0, failed: 0 });
    expect(w.shown).toEqual([["c1", "c2"]]);
    expect(w.held.size).toBe(0);
  });

  it("lets go of the chapters even when a restore throws", async () => {
    const w = workspace({
      restore: async () => {
        throw new Error("boom");
      },
    });
    await expect(makeReplaceUndo(before, w.deps)()).rejects.toThrow("boom");
    expect(w.held.size).toBe(0);
  });
});

// The real restore path against a fake server: Replace all moved c1 to
// revision 5, then the phone saved its own edit at revision 6 before this
// device's Undo.
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
  const local = { content: "<p>new one</p>", revision: 5 };
  const held = new Set<string>();
  const shown: string[][] = [];
  const sent: Array<SavePayload & { expectedRevision: number }> = [];
  // What the editor lets the writer do: typing into a held chapter goes nowhere.
  const type = (html: string) => {
    if (!held.has("c1")) local.content = html;
  };
  let duringSave: (() => void) | null = null;
  const send = async (_id: string, body: SavePayload & { expectedRevision: number }) => {
    sent.push(body);
    duringSave?.();
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
    restore: (id, content) =>
      restoreChapter({ store, send, updateChapterLocal: (_id, patch) => Object.assign(local, patch) }, id, content),
    hold: (ids) => {
      for (const id of ids) held.add(id);
      return () => {
        for (const id of ids) held.delete(id);
      };
    },
    show: (ids) => shown.push(ids),
  };
  return {
    server,
    store,
    local,
    shown,
    sent,
    deps,
    type,
    whileSaving: (fn: () => void) => {
      duringSave = fn;
    },
    phoneIsNotAhead: () => {
      server.content = "<p>new one</p>";
      server.revision = 5;
    },
  };
}

describe("undoing a replace on the real restore path", () => {
  const prior = [{ id: "c1", content: "<p>old one</p>", revision: 5 }];

  it("puts the old text back and shows it once the server has taken it", async () => {
    const w = realSave();
    w.phoneIsNotAhead();
    const result = await makeReplaceUndo(prior, w.deps)();
    expect(result).toEqual({ restored: 1, total: 1, changed: 0, failed: 0 });
    expect(w.server).toEqual({ content: "<p>old one</p>", revision: 6 });
    expect(w.local).toMatchObject({ content: "<p>old one</p>", revision: 6 });
    expect(w.store.getExpectedRevision("c1")).toBe(6);
    expect(w.shown).toEqual([["c1"]]);
  });

  it("after a remote edit, typing during the restore goes nowhere, the 409 keeps the phone's text and nothing is sent over it", async () => {
    const w = realSave();
    let editorDuringSave: string | null = null;
    w.whileSaving(() => {
      w.type("<p>new one</p><p>typed</p>");
      editorDuringSave = w.local.content;
    });
    const result = await makeReplaceUndo(prior, w.deps)();
    // The editor was untouched while the PATCH was out.
    expect(editorDuringSave).toBe("<p>new one</p>");
    // One PATCH, on the revision this device knew; nothing on the phone's revision.
    expect(w.sent).toEqual([{ content: "<p>old one</p>", expectedRevision: 5 }]);
    expect(w.server).toEqual({ content: "<p>from the phone</p>", revision: 6 });
    // The writer's copy now shows the phone's text.
    expect(w.local).toMatchObject({ content: "<p>from the phone</p>", revision: 6 });
    expect(w.store.getExpectedRevision("c1")).toBe(6);
    expect(w.shown).toEqual([["c1"]]);
    expect(result).toEqual({ restored: 0, total: 1, changed: 1, failed: 0 });
    expect(undoMessage(result)).toBe("Couldn't undo: the chapter changed since.");
  });

  it("counts a restore as restored when its answer was lost and the retry's 409 is the restore itself", async () => {
    const w = realSave();
    w.phoneIsNotAhead();
    let first = true;
    const send = async (id: string, body: SavePayload & { expectedRevision: number }) => {
      if (first) {
        first = false;
        // The server commits, then the connection drops before the answer.
        w.server.content = body.content ?? w.server.content;
        w.server.revision += 1;
        throw new Error("connection reset");
      }
      const chapter: Chapter = {
        id,
        projectId: "p1",
        title: "One",
        order: 0,
        content: w.server.content,
        summary: "",
        status: "draft",
        wordCount: 2,
        revision: w.server.revision,
      };
      return new Response(JSON.stringify({ chapter }), { status: 409 });
    };
    w.deps.restore = (id, content) =>
      restoreChapter({ store: w.store, send, updateChapterLocal: (_id, patch) => Object.assign(w.local, patch) }, id, content);
    const result = await makeReplaceUndo(prior, w.deps)();
    expect(result).toEqual({ restored: 1, total: 1, changed: 0, failed: 0 });
    expect(undoMessage(result)).toBeNull();
    expect(w.local).toMatchObject({ content: "<p>old one</p>", revision: 6 });
    expect(w.store.getExpectedRevision("c1")).toBe(6);
  });

  it("still calls it a conflict when the retry's 409 carries another device's text", async () => {
    const w = realSave();
    let first = true;
    const send = async (id: string) => {
      if (first) {
        first = false;
        throw new Error("connection reset");
      }
      const chapter: Chapter = {
        id,
        projectId: "p1",
        title: "One",
        order: 0,
        content: w.server.content,
        summary: "",
        status: "draft",
        wordCount: 2,
        revision: w.server.revision,
      };
      return new Response(JSON.stringify({ chapter }), { status: 409 });
    };
    w.deps.restore = (id, content) =>
      restoreChapter({ store: w.store, send, updateChapterLocal: (_id, patch) => Object.assign(w.local, patch) }, id, content);
    const result = await makeReplaceUndo(prior, w.deps)();
    expect(result).toEqual({ restored: 0, total: 1, changed: 1, failed: 0 });
    expect(w.local).toMatchObject({ content: "<p>from the phone</p>", revision: 6 });
  });

  it("leaves the writer's copy alone when the server cannot be reached", async () => {
    const w = realSave();
    w.deps.restore = (id, content) =>
      restoreChapter(
        {
          store: w.store,
          send: async () => {
            throw new Error("offline");
          },
          updateChapterLocal: (_id, patch) => Object.assign(w.local, patch),
        },
        id,
        content
      );
    const result = await makeReplaceUndo(prior, w.deps)();
    expect(result).toEqual({ restored: 0, total: 1, changed: 0, failed: 1 });
    expect(w.local).toEqual({ content: "<p>new one</p>", revision: 5 });
    expect(w.shown).toEqual([]);
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

  it("pluralises when every chapter was edited since", () => {
    expect(undoMessage(result({ total: 3, changed: 3 }))).toBe("Couldn't undo: the chapters changed since.");
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
