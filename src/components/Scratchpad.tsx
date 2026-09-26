"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SCRATCH_CONTENT_MAX,
  SCRATCH_TITLE_MAX,
  scratchNoteExcerpt,
  scratchNoteTitle,
  type ScratchNote,
} from "@/lib/scratch-view";

type Props = {
  projectId: string;
  onClose: () => void;
};

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const SAVE_DELAY_MS = 800;
const REFRESH_MS = 20_000;

type Unsaved = { title: string; content: string; revision: number };
type SaveResult =
  | { kind: "saved"; note: ScratchNote }
  | { kind: "conflict"; note: ScratchNote }
  | { kind: "error"; message: string };

// Typing that couldn't reach the server waits here, so it survives leaving the
// note, closing the drawer or reloading, and is retried on the next refresh.
function unsavedKey(projectId: string) {
  return `ciciro:scratch-unsaved:${projectId}`;
}

function readUnsaved(projectId: string): Record<string, Unsaved> {
  try {
    const raw = window.localStorage.getItem(unsavedKey(projectId));
    return raw ? (JSON.parse(raw) as Record<string, Unsaved>) : {};
  } catch {
    return {};
  }
}

function writeUnsaved(projectId: string, all: Record<string, Unsaved>) {
  try {
    if (Object.keys(all).length === 0) window.localStorage.removeItem(unsavedKey(projectId));
    else window.localStorage.setItem(unsavedKey(projectId), JSON.stringify(all));
  } catch {
    // Storage full or blocked: the draft still lives in memory while the drawer is open.
  }
}

// The scratchpad: notes and research beside the chapters. They are not part of
// the manuscript, so they never count as words and never reach an export.
export default function Scratchpad({ projectId, onClose }: Props) {
  const base = `/api/projects/${projectId}/scratch`;
  const [notes, setNotes] = useState<ScratchNote[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<ScratchNote | null>(null);
  const [unsaved, setUnsaved] = useState<Record<string, Unsaved>>({});

  // Live copies for the debounced save and the refresh loop, which outlive renders.
  const draft = useRef({ title: "", content: "" });
  const revision = useRef(0);
  const dirty = useRef(false);
  const conflict = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const writes = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const stash = useCallback(
    (id: string, value: Unsaved | null) => {
      const all = readUnsaved(projectId);
      if (value) all[id] = value;
      else delete all[id];
      writeUnsaved(projectId, all);
      setUnsaved(all);
    },
    [projectId]
  );

  const push = useCallback(
    async (id: string, body: Unsaved): Promise<SaveResult> => {
      try {
        const res = await fetch(`${base}/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: body.title,
            content: body.content,
            expectedRevision: body.revision,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.note) return { kind: "conflict", note: data.note };
        if (!res.ok) return { kind: "error", message: data.error || "Couldn't save the note." };
        return { kind: "saved", note: data as ScratchNote };
      } catch {
        return { kind: "error", message: "Couldn't save the note." };
      }
    },
    [base]
  );

  // Retry notes whose typing is still waiting from an earlier failed save.
  const retryUnsaved = useCallback(
    async (list: ScratchNote[]) => {
      const all = readUnsaved(projectId);
      for (const [id, body] of Object.entries(all)) {
        if (id === activeRef.current) continue;
        if (!list.some((n) => n.id === id)) {
          stash(id, null);
          continue;
        }
        const result = await push(id, body);
        if (result.kind !== "saved") continue;
        writes.current += 1;
        stash(id, null);
        setNotes((prev) => [result.note, ...(prev ?? []).filter((n) => n.id !== id)]);
      }
    },
    [projectId, push, stash]
  );

  const load = useCallback(async () => {
    const startedAt = writes.current;
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load the scratchpad.");
      // A save, add or delete since this request began makes its answer stale.
      if (writes.current !== startedAt || saving.current) return;
      const list = data.notes as ScratchNote[];
      setNotes(list);
      setError(null);
      void retryUnsaved(list);
      if (activeRef.current && dirty.current && !conflict.current && !timer.current) {
        void flushRef.current();
      }
      // Pick up another device's edit to the open note unless we have our own pending.
      const open = list.find((n) => n.id === activeRef.current);
      if (open && !dirty.current && open.revision > revision.current) show(open);
      if (activeRef.current && !open) {
        setActiveId(null);
        dirty.current = false;
        conflict.current = false;
        setState("saved");
      }
    } catch (e) {
      setError((e as Error).message);
      setNotes((prev) => prev ?? []);
    }
  }, [base, retryUnsaved]);

  function show(note: ScratchNote) {
    draft.current = { title: note.title, content: note.content };
    revision.current = note.revision;
    dirty.current = false;
    conflict.current = false;
    setTitle(note.title);
    setContent(note.content);
    setRemote(null);
    setState("saved");
  }

  // Reopening a note whose last save failed brings that typing back and retries it.
  function restore(note: ScratchNote) {
    const pending = readUnsaved(projectId)[note.id];
    show(note);
    if (!pending) return;
    draft.current = { title: pending.title, content: pending.content };
    revision.current = pending.revision;
    dirty.current = true;
    setTitle(pending.title);
    setContent(pending.content);
    setState("dirty");
    schedule();
  }

  useEffect(() => {
    setUnsaved(readUnsaved(projectId));
    void load();
    const interval = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, projectId]);

  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flushRef.current();
    }, SAVE_DELAY_MS);
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) await saving.current;
    const id = activeRef.current;
    if (!id || !dirty.current) return true;
    if (conflict.current) return false;
    const sent = { ...draft.current, revision: revision.current };
    const run = (async (): Promise<boolean> => {
      setState("saving");
      const result = await push(id, sent);
      if (result.kind === "conflict") {
        conflict.current = true;
        stash(id, { ...draft.current, revision: revision.current });
        setRemote(result.note);
        setState("conflict");
        return false;
      }
      if (result.kind === "error") {
        stash(id, { ...draft.current, revision: revision.current });
        setError(result.message);
        setState("error");
        return false;
      }
      const saved = result.note;
      writes.current += 1;
      revision.current = saved.revision;
      const same =
        draft.current.title === sent.title && draft.current.content === sent.content;
      if (same) dirty.current = false;
      stash(id, same ? null : { ...draft.current, revision: saved.revision });
      setNotes((prev) => [saved, ...(prev ?? []).filter((n) => n.id !== saved.id)]);
      setError(null);
      setState(same ? "saved" : "dirty");
      return true;
    })();
    saving.current = run;
    const ok = await run;
    saving.current = null;
    if (ok && dirty.current) schedule();
    return ok && !dirty.current;
  }, [push, schedule, stash]);
  flushRef.current = flush;

  // Leaving with unsaved typing (closing the drawer) saves it first.
  useEffect(() => {
    return () => {
      if (dirty.current) void flush();
    };
  }, [flush]);

  function edit(next: { title?: string; content?: string }) {
    draft.current = { ...draft.current, ...next };
    if (next.title !== undefined) setTitle(next.title);
    if (next.content !== undefined) setContent(next.content);
    dirty.current = true;
    if (conflict.current) return;
    setState("dirty");
    schedule();
  }

  // Leaving a note is only held back by an open conflict, which has its own
  // choice. A failed save keeps the typing aside and retries it later.
  async function leave() {
    await flush();
    if (conflict.current) return false;
    dirty.current = false;
    setState("saved");
    return true;
  }

  async function open(note: ScratchNote) {
    if (!(await leave())) return;
    setActiveId(note.id);
    activeRef.current = note.id;
    restore(notes?.find((n) => n.id === note.id) ?? note);
  }

  async function back() {
    if (!(await leave())) return;
    setActiveId(null);
    activeRef.current = null;
    setRemote(null);
    void load();
  }

  async function add() {
    if (!(await leave())) return;
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add a note.");
      const note = data as ScratchNote;
      writes.current += 1;
      setNotes((prev) => [note, ...(prev ?? [])]);
      setActiveId(note.id);
      activeRef.current = note.id;
      show(note);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(note: ScratchNote) {
    if (!confirm(`Delete "${scratchNoteTitle(note, "Untitled note")}"?`)) return;
    try {
      const res = await fetch(`${base}/${note.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't delete the note.");
      }
      writes.current += 1;
      stash(note.id, null);
      if (activeRef.current === note.id) {
        dirty.current = false;
        conflict.current = false;
        setRemote(null);
        setState("saved");
        setActiveId(null);
        activeRef.current = null;
      }
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== note.id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Conflict: take the other device's version, or keep ours on top of it.
  function takeTheirs() {
    if (!remote || !activeRef.current) return;
    stash(activeRef.current, null);
    show(remote);
  }
  function keepMine() {
    if (!remote) return;
    revision.current = remote.revision;
    conflict.current = false;
    setRemote(null);
    setState("dirty");
    void flush();
  }

  async function close() {
    if (!(await leave())) return;
    onClose();
  }

  const active = notes?.find((n) => n.id === activeId) ?? null;
  const status =
    state === "saving"
      ? "Saving…"
      : state === "dirty"
        ? "Unsaved changes"
        : state === "error"
          ? "Not saved yet"
          : state === "conflict"
            ? "Changed elsewhere"
            : "Saved";

  return (
    <>
      <div className="drawer-overlay" onClick={close} />
      <div className="drawer scratchpad" role="dialog" aria-label="Scratchpad">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>Scratchpad</h2>
          <button className="btn ghost small" onClick={close}>
            Close
          </button>
        </div>
        <p className="scratch-hint">
          Notes and research for this manuscript. They stay out of your word counts and
          exports, and sync to your phone.
        </p>
        {error && (
          <div className="scratch-error" role="alert">
            {error}
          </div>
        )}

        {!active ? (
          <>
            <button className="btn primary small" onClick={add}>
              New note
            </button>
            <div style={{ marginTop: 12 }}>
              {notes === null && <div className="empty">Loading…</div>}
              {notes?.length === 0 && (
                <div className="empty">
                  Nothing here yet. Jot down a name, a fact to check, a scene idea.
                </div>
              )}
              {notes?.map((note) => (
                <div className="bible-item scratch-item" key={note.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className="scratch-item-main"
                    onClick={() => void open(note)}
                    onKeyDown={(e) => e.key === "Enter" && void open(note)}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {scratchNoteTitle(note, "Untitled note")}
                    </div>
                    <div className="scratch-excerpt">
                      {scratchNoteExcerpt(unsaved[note.id] ?? note)}
                    </div>
                    {unsaved[note.id] && (
                      <div className="scratch-unsaved">Not saved yet, will retry</div>
                    )}
                  </div>
                  <button
                    className="btn ghost small"
                    aria-label={`Delete ${scratchNoteTitle(note, "Untitled note")}`}
                    onClick={() => void remove(note)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="scratch-bar">
              <button className="btn ghost small" onClick={back}>
                &larr; All notes
              </button>
              <span className="scratch-status" data-state={state}>
                {status}
                {state === "error" && (
                  <button className="btn ghost small" onClick={() => void flush()}>
                    Retry
                  </button>
                )}
              </span>
              <button className="btn ghost small" onClick={() => void remove(active)}>
                Delete
              </button>
            </div>
            {state === "conflict" && remote && (
              <div className="scratch-conflict" role="alert">
                This note was changed on another device.
                <div className="scratch-conflict-actions">
                  <button className="btn small" onClick={takeTheirs}>
                    Use that version
                  </button>
                  <button className="btn small" onClick={keepMine}>
                    Keep mine
                  </button>
                </div>
              </div>
            )}
            <input
              className="scratch-title"
              placeholder="Title"
              aria-label="Note title"
              maxLength={SCRATCH_TITLE_MAX}
              value={title}
              onChange={(e) => edit({ title: e.target.value })}
            />
            <textarea
              className="scratch-body"
              placeholder="Write anything…"
              aria-label="Note text"
              maxLength={SCRATCH_CONTENT_MAX}
              value={content}
              onChange={(e) => edit({ content: e.target.value })}
              rows={24}
              autoFocus
            />
          </>
        )}
      </div>
    </>
  );
}
