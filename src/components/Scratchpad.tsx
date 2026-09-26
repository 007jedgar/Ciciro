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

  // Live copies for the debounced save and the refresh loop, which outlive renders.
  const draft = useRef({ title: "", content: "" });
  const revision = useRef(0);
  const dirty = useRef(false);
  const conflict = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load the scratchpad.");
      const list = data.notes as ScratchNote[];
      setNotes(list);
      setError(null);
      // Pick up another device's edit to the open note unless we have our own pending.
      const open = list.find((n) => n.id === activeRef.current);
      if (open && !dirty.current && open.revision !== revision.current) show(open);
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
  }, [base]);

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

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const flushRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS);
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) await saving.current;
    const id = activeRef.current;
    if (!id || !dirty.current) return;
    const sent = { ...draft.current };
    const run = (async () => {
      setState("saving");
      try {
        const res = await fetch(`${base}/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...sent, expectedRevision: revision.current }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.note) {
          conflict.current = true;
          setRemote(data.note as ScratchNote);
          setState("conflict");
          return;
        }
        if (!res.ok) throw new Error(data.error || "Couldn't save the note.");
        const saved = data as ScratchNote;
        revision.current = saved.revision;
        const same =
          draft.current.title === sent.title && draft.current.content === sent.content;
        if (same) dirty.current = false;
        setNotes((prev) => [saved, ...(prev ?? []).filter((n) => n.id !== saved.id)]);
        setError(null);
        setState(same ? "saved" : "dirty");
      } catch (e) {
        setError((e as Error).message);
        setState("error");
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
    if (dirty.current && !conflict.current) schedule();
  }, [base, schedule]);
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

  async function open(note: ScratchNote) {
    await flush();
    setActiveId(note.id);
    activeRef.current = note.id;
    show(notes?.find((n) => n.id === note.id) ?? note);
  }

  async function back() {
    await flush();
    setActiveId(null);
    activeRef.current = null;
    setRemote(null);
    void load();
  }

  async function add() {
    await flush();
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add a note.");
      const note = data as ScratchNote;
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
      if (activeRef.current === note.id) {
        dirty.current = false;
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
    if (remote) show(remote);
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
    await flush();
    onClose();
  }

  const active = notes?.find((n) => n.id === activeId) ?? null;
  const status =
    state === "saving"
      ? "Saving…"
      : state === "dirty"
        ? "Unsaved changes"
        : state === "error"
          ? "Couldn't save"
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
                    <div className="scratch-excerpt">{scratchNoteExcerpt(note)}</div>
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
