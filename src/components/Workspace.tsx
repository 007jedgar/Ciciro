"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Editor, { type EditorHandle } from "@/components/Editor";
import ChapterSidebar from "@/components/ChapterSidebar";
import ChatPanel, { type ChatHandle } from "@/components/ChatPanel";
import StoryBible from "@/components/StoryBible";
import AutoWrite from "@/components/AutoWrite";
import OpenQuestions from "@/components/OpenQuestions";
import DiffView from "@/components/DiffView";
import ExportMenu from "@/components/ExportMenu";
import ChapterHistory from "@/components/ChapterHistory";
import SearchPanel from "@/components/SearchPanel";
import ThemePicker from "@/components/ThemePicker";
import WritingMeter from "@/components/WritingMeter";
import ManuscriptPaceMeter from "@/components/ManuscriptPaceMeter";
import { useSettings } from "@/components/SettingsProvider";
import { countWords, htmlToText } from "@/lib/text";
import { CHAT_WIDTH_MAX, CHAT_WIDTH_MIN } from "@/lib/settings";
import { OptimisticChapterStore, handleNetworkFailure } from "@/lib/optimistic-chapter";
import { positiveWordDelta } from "@/lib/writing-day";
import { noteWritingStroke, noteWritingWords } from "@/lib/writing-day-client";
import { uploadImport } from "@/lib/import-client";
import type { ReplacedChapter, SearchMatch } from "@/lib/search-client";
import type { Project, Chapter, OpenQuestion, ClientUiEvent } from "@/lib/types";

type SaveState = "saved" | "saving" | "error" | "restored";

const CHAT_MIN = CHAT_WIDTH_MIN;
const CHAT_MAX = CHAT_WIDTH_MAX;

function clampChatWidth(n: number) {
  return Math.min(CHAT_MAX, Math.max(CHAT_MIN, Math.round(n)));
}

export default function Workspace({ initialProject }: { initialProject: Project }) {
  const [project, setProject] = useState<Project>(initialProject);
  const [activeId, setActiveId] = useState<string | null>(
    initialProject.chapters[0]?.id ?? null
  );
  const [bibleOpen, setBibleOpen] = useState(false);
  const [autoWriteOpen, setAutoWriteOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Bumped to remount the editor when its chapter was rewritten from outside.
  const [editorNonce, setEditorNonce] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [viewMode, setViewMode] = useState<"prose" | "diff" | "history">("prose");
  const [diffRefreshToken, setDiffRefreshToken] = useState(0);
  const { settings, patch } = useSettings();
  const [dragChatWidth, setDragChatWidth] = useState<number | null>(null);
  const chatWidth = dragChatWidth ?? settings.chatWidth;
  const [resizing, setResizing] = useState(false);

  const editorRef = useRef<EditorHandle>(null);
  const chatRef = useRef<ChatHandle>(null);
  const optimisticStoreRef = useRef<OptimisticChapterStore | null>(null);
  if (!optimisticStoreRef.current) {
    const store = new OptimisticChapterStore();
    store.init(initialProject.chapters);
    optimisticStoreRef.current = store;
  }
  const projectRef = useRef(project);
  projectRef.current = project;
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  // Chapters whose typed content the server has not accepted.
  const unsavedContentRef = useRef(new Set<string>());
  const saveStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the editor opens/creates a chapter, mount TipTap with the caret at
  // the end so Auto-mode drafts continue rather than prepending.
  const [focusEndOnMount, setFocusEndOnMount] = useState(false);
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resumePosition, setResumePosition] = useState<{
    chapterId: string;
    blockId: string;
    offset: number;
    length?: number;
  } | null>(null);
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;

  const persistChatWidth = useCallback((w: number) => {
    patch({ chatWidth: clampChatWidth(w) });
  }, [patch]);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      setResizing(true);
      const startX = e.clientX;
      const startW = chatWidthRef.current;
      let latest = startW;

      function onMove(ev: PointerEvent) {
        latest = clampChatWidth(startW - (ev.clientX - startX));
        setDragChatWidth(latest);
      }
      function onUp(ev: PointerEvent) {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        setResizing(false);
        persistChatWidth(latest);
        setDragChatWidth(null);
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [persistChatWidth]
  );

  const activeChapter = useMemo(
    () => project.chapters.find((c) => c.id === activeId) ?? null,
    [project.chapters, activeId]
  );

  const updateChapterLocal = useCallback((id: string, fields: Partial<Chapter>) => {
    setProject((p) => ({
      ...p,
      chapters: p.chapters.map((c) => (c.id === id ? { ...c, ...fields } : c)),
    }));
  }, []);

  const showTransientSaveState = useCallback((state: "error" | "restored") => {
    setSaveState(state);
    if (saveStateTimer.current) clearTimeout(saveStateTimer.current);
    saveStateTimer.current = setTimeout(() => {
      if (pendingSaveCountRef.current === 0) setSaveState("saved");
    }, 3000);
  }, []);

  const getLocalFields = useCallback((id: string) => {
    const ch = projectRef.current.chapters.find((c) => c.id === id);
    if (!ch) return null;
    return { content: ch.content, title: ch.title, status: ch.status };
  }, []);

  const patchChapter = useCallback(
    (id: string, fields: Partial<Pick<Chapter, "content" | "title" | "status">>) => {
      if (saveStateTimer.current) clearTimeout(saveStateTimer.current);
      pendingSaveCountRef.current += 1;
      setSaveState("saving");
      const inFlight = { ...fields };

      saveQueueRef.current = saveQueueRef.current
        .catch(() => {})
        .then(async () => {
          const store = optimisticStoreRef.current!;

          const attemptSave = async (
            payload: typeof inFlight
          ): Promise<"ok" | "409-retry" | "409-restored" | "fail"> => {
            const expectedRevision = store.getExpectedRevision(id);
            if (expectedRevision == null) return "fail";
            try {
              const res = await fetch(`/api/chapters/${id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ...payload, expectedRevision }),
              });
              if (res.status === 409) {
                const body = (await res.json()) as { chapter?: Chapter };
                const serverChapter = body.chapter;
                const local = getLocalFields(id);
                if (!serverChapter || !local) return "fail";

                const result = store.apply409(id, serverChapter, local, payload);
                updateChapterLocal(id, result.localPatch);

                if (result.retry) {
                  Object.assign(payload, result.retry);
                  return "409-retry";
                }
                showTransientSaveState("restored");
                return "409-restored";
              }
              if (!res.ok) return "fail";
              const chapter = (await res.json()) as Chapter;
              const { localPatch } = store.applySuccess(id, chapter);
              updateChapterLocal(id, localPatch);
              return "ok";
            } catch {
              return "fail";
            }
          };

          const payload = { ...inFlight };
          let outcome = await attemptSave(payload);
          if (outcome === "fail") {
            outcome = await attemptSave(payload);
          } else if (outcome === "409-retry") {
            outcome = await attemptSave(payload);
            if (outcome === "409-retry") {
              outcome = await attemptSave(payload);
            }
          }
          let settled = outcome !== "fail" && outcome !== "409-retry";
          if (outcome === "fail") {
            const confirmed = store.get(id);
            const local = getLocalFields(id);
            if (confirmed && local) {
              const failure = handleNetworkFailure(confirmed, local, payload);
              if (failure.localPatch) {
                updateChapterLocal(id, failure.localPatch);
                settled = true;
              }
              showTransientSaveState(failure.uiHint);
            } else {
              showTransientSaveState("error");
            }
          }
          if ("content" in payload) {
            if (settled) unsavedContentRef.current.delete(id);
            else unsavedContentRef.current.add(id);
          }
        })
        .finally(() => {
          pendingSaveCountRef.current -= 1;
          if (pendingSaveCountRef.current === 0) {
            setSaveState((s) => (s === "saving" ? "saved" : s));
          }
        });
    },
    [updateChapterLocal, getLocalFields, showTransientSaveState]
  );

  // --- Content autosave (debounced) ---
  const onContentChange = useCallback(
    (html: string) => {
      if (!activeId) return;
      const prevWords =
        projectRef.current.chapters.find((c) => c.id === activeId)?.wordCount ?? 0;
      const nextWords = countWords(htmlToText(html));
      noteWritingWords(positiveWordDelta(prevWords, nextWords));
      updateChapterLocal(activeId, {
        content: html,
        wordCount: nextWords,
      });
      if (contentTimer.current) clearTimeout(contentTimer.current);
      contentTimer.current = setTimeout(() => {
        patchChapter(activeId, { content: html });
      }, 1000);
    },
    [activeId, patchChapter, updateChapterLocal]
  );

  /**
   * Send any debounced typing now and wait for every queued save to land.
   * Resolves false when the active chapter still has text the server lacks.
   */
  const flushSaves = useCallback(async (): Promise<boolean> => {
    if (contentTimer.current && activeId) {
      clearTimeout(contentTimer.current);
      contentTimer.current = null;
      const local = projectRef.current.chapters.find((c) => c.id === activeId);
      if (local) patchChapter(activeId, { content: local.content });
    }
    await saveQueueRef.current.catch(() => {});
    if (pendingSaveCountRef.current > 0) return false;
    const local = activeId ? getLocalFields(activeId) : null;
    const store = optimisticStoreRef.current;
    return !(activeId && local && store?.hasLocalEdits(activeId, local));
  }, [activeId, getLocalFields, patchChapter]);

  /** A restore committed on the server; its result is the new confirmed head. */
  const onChapterRestored = useCallback(
    (chapter: Chapter) => {
      optimisticStoreRef.current?.setConfirmed(chapter.id, {
        content: chapter.content,
        title: chapter.title,
        status: chapter.status,
        revision: chapter.revision,
        wordCount: chapter.wordCount,
      });
      updateChapterLocal(chapter.id, {
        content: chapter.content,
        wordCount: chapter.wordCount,
        revision: chapter.revision,
      });
    },
    [updateChapterLocal]
  );

  const onTitleChange = useCallback(
    (title: string) => {
      if (!activeId) return;
      updateChapterLocal(activeId, { title });
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        patchChapter(activeId, { title });
      }, 700);
    },
    [activeId, patchChapter, updateChapterLocal]
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${project.id}/position`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { position?: { chapterId: string; blockId: string; offset: number } | null } | null) => {
        if (cancelled || !data?.position) return;
        setResumePosition(data.position);
        setActiveId(data.position.chapterId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const onCaretChange = useCallback(
    (caret: { blockId: string; offset: number }) => {
      if (!activeId) return;
      noteWritingStroke();
      if (positionTimer.current) clearTimeout(positionTimer.current);
      positionTimer.current = setTimeout(() => {
        void fetch(`/api/projects/${project.id}/position`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chapterId: activeId,
            blockId: caret.blockId,
            offset: caret.offset,
          }),
        });
      }, 600);
    },
    [activeId, project.id]
  );

  // --- Manuscript search ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Push a pending edit out and wait for the save queue, so a replace starts
  // from what the author has actually typed. False when text in scope is still
  // unsaved (a save failed), since the replace would overwrite it.
  const flushSaves = useCallback(
    async (chapterId?: string) => {
      if (contentTimer.current && activeId) {
        clearTimeout(contentTimer.current);
        contentTimer.current = null;
        const local = getLocalFields(activeId);
        if (local) patchChapter(activeId, { content: local.content });
      }
      let queue: Promise<void>;
      do {
        queue = saveQueueRef.current;
        await queue.catch(() => {});
      } while (queue !== saveQueueRef.current);
      const unsaved = unsavedContentRef.current;
      return !projectRef.current.chapters.some(
        (c) => unsaved.has(c.id) && (!chapterId || c.id === chapterId)
      );
    },
    [activeId, getLocalFields, patchChapter]
  );

  const onSearchReplaced = useCallback(
    (replaced: ReplacedChapter[]) => {
      const store = optimisticStoreRef.current;
      for (const r of replaced) {
        const local = projectRef.current.chapters.find((c) => c.id === r.id);
        store?.setConfirmed(r.id, {
          content: r.content,
          title: local?.title ?? "",
          status: local?.status ?? "draft",
          revision: r.revision,
          wordCount: r.wordCount,
        });
        updateChapterLocal(r.id, {
          content: r.content,
          wordCount: r.wordCount,
          revision: r.revision,
        });
      }
      if (activeId && replaced.some((r) => r.id === activeId)) {
        setResumePosition(null);
        setEditorNonce((n) => n + 1);
      }
    },
    [activeId, updateChapterLocal]
  );

  const onSearchJump = useCallback(
    (match: SearchMatch, length: number) => {
      setSearchOpen(false);
      setViewMode("prose");
      setFocusEndOnMount(false);
      setResumePosition({
        chapterId: match.chapterId,
        blockId: match.blockId,
        offset: match.offset,
        length,
      });
      setActiveId(match.chapterId);
      // Same chapter: remount so the caret restore runs again.
      if (match.chapterId === activeId) setEditorNonce((n) => n + 1);
    },
    [activeId]
  );

  // --- Chapter operations ---
  async function addChapter() {
    const res = await fetch("/api/chapters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    const chapter: Chapter = await res.json();
    optimisticStoreRef.current?.seed(chapter);
    setProject((p) => ({ ...p, chapters: [...p.chapters, chapter] }));
    setActiveId(chapter.id);
  }

  async function importChapters(file: File) {
    const result = await uploadImport(file, { projectId: project.id });
    const res = await fetch(`/api/chapters?projectId=${encodeURIComponent(project.id)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Imported, but could not refresh the chapter list. Reload the page.");
    const imported = new Set(result.chapters.map((c) => c.id));
    const added = ((await res.json()) as Chapter[]).filter((c) => imported.has(c.id));
    for (const chapter of added) optimisticStoreRef.current?.seed(chapter);
    setProject((p) => ({ ...p, chapters: [...p.chapters, ...added] }));
    const first = result.chapters[0];
    if (first) setActiveId(first.id);
  }

  async function deleteChapter(id: string) {
    const res = await fetch(`/api/chapters/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      window.alert(err?.error || "Chapter must be empty to delete.");
      return;
    }
    setProject((p) => {
      const chapters = p.chapters
        .filter((c) => c.id !== id)
        .map((c, i) => ({ ...c, order: i }));
      return { ...p, chapters };
    });
    if (activeId === id) {
      const remaining = project.chapters.filter((c) => c.id !== id);
      setActiveId(remaining[0]?.id ?? null);
    }
  }

  function insertDraft(text: string, key?: string) {
    editorRef.current?.insertDraft(text, key);
  }
  const getSelection = useCallback(() => editorRef.current?.getSelection() ?? "", []);

  const refreshQuestions = useCallback(() => {
    fetch(`/api/questions?projectId=${project.id}&status=open`)
      .then((r) => r.json())
      .then((qs) => Array.isArray(qs) && setOpenCount(qs.length))
      .catch(() => {});
  }, [project.id]);

  useEffect(() => {
    refreshQuestions();
  }, [refreshQuestions]);

  const selectChapterForAi = useCallback((chapterId: string) => {
    if (chapterId === activeId) {
      // Already open - just move the caret so Auto-mode drafts append.
      editorRef.current?.focusEnd();
      return;
    }
    setFocusEndOnMount(true);
    setActiveId(chapterId);
  }, [activeId]);

  // Mid-turn side-effects from editor tools (move/insert/create/open chapter).
  const onUiEvent = useCallback(
    (evt: ClientUiEvent) => {
      if (evt.type === "open_chapter") {
        selectChapterForAi(evt.chapterId);
        return;
      }
      if (evt.type === "chapter_created") {
        optimisticStoreRef.current?.seed(evt.chapter);
        setProject((p) => {
          const chapters = [
            ...p.chapters.map((c) =>
              c.order >= evt.chapter.order ? { ...c, order: c.order + 1 } : c
            ),
            evt.chapter,
          ].sort((a, b) => a.order - b.order);
          return { ...p, chapters };
        });
        if (evt.open) selectChapterForAi(evt.chapter.id);
        return;
      }
      if (evt.type === "chapter_updated") {
        const store = optimisticStoreRef.current;
        const local = projectRef.current.chapters.find((c) => c.id === evt.chapterId);
        if (
          evt.chapterId === activeId &&
          local &&
          store &&
          (pendingSaveCountRef.current > 0 || store.hasLocalEdits(evt.chapterId, local))
        ) {
          return;
        }
        if (evt.revision != null) {
          store?.setConfirmed(evt.chapterId, {
            content: evt.content,
            title: evt.title ?? local?.title ?? "",
            status: local?.status ?? "draft",
            revision: evt.revision,
            wordCount: evt.wordCount,
          });
        }
        updateChapterLocal(evt.chapterId, {
          content: evt.content,
          wordCount: evt.wordCount,
          ...(evt.revision != null ? { revision: evt.revision } : {}),
          ...(evt.title != null ? { title: evt.title } : {}),
        });
      }
    },
    [activeId, updateChapterLocal, selectChapterForAi]
  );

  // After each editor turn, reflect any manuscript corrections it made and refresh
  // the open-question count. Don't clobber the active chapter if it has unsaved edits.
  const onTurnComplete = useCallback(async () => {
    refreshQuestions();
    setDiffRefreshToken((t) => t + 1);
    try {
      const res = await fetch(`/api/projects/${project.id}`);
      const fresh = await res.json();
      if (fresh?.chapters) {
        const remote = fresh.chapters as Chapter[];
        setProject((p) => {
          const store = optimisticStoreRef.current;
          const merged = remote.map((nc) => {
            const local = p.chapters.find((c) => c.id === nc.id);
            if (
              local &&
              local.id === activeId &&
              store &&
              (pendingSaveCountRef.current > 0 ||
                store.hasLocalEdits(nc.id, local))
            ) {
              return { ...nc, content: local.content, wordCount: local.wordCount, title: local.title, status: local.status };
            }
            store?.setConfirmed(nc.id, {
              content: nc.content,
              title: nc.title,
              status: nc.status,
              revision: nc.revision,
              wordCount: nc.wordCount,
            });
            return nc;
          });
          return { ...p, chapters: merged };
        });
        // If the open chapter was deleted remotely, fall back.
        setActiveId((id) => {
          if (id && remote.some((c) => c.id === id)) return id;
          return remote[0]?.id ?? null;
        });
      }
    } catch {
      /* ignore refresh failure */
    }
  }, [project.id, activeId, refreshQuestions]);

  function answerQuestion(q: OpenQuestion, answer: string) {
    const msg = `I'm answering an open question. [id: ${q.id}] Question: "${q.question}". You provisionally went with: "${
      q.provisional || "n/a"
    }". My answer: ${answer}. Reconcile the manuscript and bible: if your provisional choice already matches, just resolve it; if it differs, correct the affected prose and the bible, then resolve it. Report what you changed.`;
    chatRef.current?.send(msg, "reconcile");
    setQuestionsOpen(false);
  }

  return (
    <div
      className={`workspace${resizing ? " resizing" : ""}`}
      style={{ ["--chat-width" as string]: `${chatWidth}px` }}
    >
      <div className="topbar">
        <Link href="/" className="btn ghost small">
          &larr; Manuscripts
        </Link>
        <span className="title">{project.title}</span>
        <WritingMeter />
        <ManuscriptPaceMeter projectId={project.id} />
        <span className="spacer" />
        <span className="save-state">
          {saveState === "saving"
            ? "Saving..."
            : saveState === "restored"
              ? "Couldn't save — restored"
              : saveState === "error"
                ? "Couldn't save — retrying"
                : "All changes saved"}
        </span>
        <ThemePicker compact />
        <button
          className="btn small"
          onClick={() => setSearchOpen(true)}
          title="Find and replace across every chapter (Cmd/Ctrl+Shift+F)"
        >
          Search
        </button>
        <button className="btn small" onClick={() => setQuestionsOpen(true)}>
          Questions{openCount ? ` (${openCount})` : ""}
        </button>
        <button className="btn small" onClick={() => setBibleOpen(true)}>
          Story bible
        </button>
        <ExportMenu projectId={project.id} />
      </div>

      <ChapterSidebar
        chapters={project.chapters}
        activeId={activeId}
        onSelect={(id) => {
          setFocusEndOnMount(false);
          setActiveId(id);
        }}
        onAdd={addChapter}
        onDelete={deleteChapter}
        onImport={importChapters}
      />

      <div className="editor-pane">
        <div className="editor-inner">
          {activeChapter ? (
            <>
              <input
                className="editor-title"
                value={activeChapter.title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Chapter title"
                spellCheck={settings.autoCorrect}
              />
              <div className="editor-meta">
                <span>{activeChapter.wordCount.toLocaleString()} words</span>
                <span>-</span>
                <select
                  value={activeChapter.status}
                  onChange={(e) => {
                    updateChapterLocal(activeChapter.id, { status: e.target.value });
                    patchChapter(activeChapter.id, { status: e.target.value });
                  }}
                  style={{ width: "auto", padding: "2px 6px" }}
                >
                  <option value="draft">draft</option>
                  <option value="revised">revised</option>
                  <option value="final">final</option>
                </select>
                <span>-</span>
                <button
                  className="btn ghost small"
                  onClick={() => setAutoWriteOpen(true)}
                  title="Let Ciciro draft this chapter autonomously"
                >
                  Auto-draft
                </button>
                <span style={{ flex: 1 }} />
                <div className="view-toggle">
                  <button
                    className={`btn small ${viewMode === "prose" ? "primary" : "ghost"}`}
                    onClick={() => setViewMode("prose")}
                  >
                    Prose
                  </button>
                  <button
                    className={`btn small ${viewMode === "diff" ? "primary" : "ghost"}`}
                    onClick={() => setViewMode("diff")}
                    title="See the editor's recent corrections to this chapter"
                  >
                    Diff
                  </button>
                  <button
                    className={`btn small ${viewMode === "history" ? "primary" : "ghost"}`}
                    onClick={() => setViewMode("history")}
                    title="Snapshots of this chapter you can compare and restore"
                  >
                    History
                  </button>
                </div>
              </div>
              {viewMode === "prose" ? (
                <Editor
                  key={`${activeChapter.id}:${editorNonce}`}
                  ref={editorRef}
                  content={activeChapter.content}
                  onChange={onContentChange}
                  onCaretChange={onCaretChange}
                  restorePosition={
                    !focusEndOnMount && resumePosition?.chapterId === activeChapter.id
                      ? {
                          blockId: resumePosition.blockId,
                          offset: resumePosition.offset,
                          length: resumePosition.length,
                        }
                      : null
                  }
                  focusEndOnMount={focusEndOnMount}
                />
              ) : viewMode === "diff" ? (
                <DiffView chapterId={activeChapter.id} refreshToken={diffRefreshToken} />
              ) : (
                <ChapterHistory
                  chapterId={activeChapter.id}
                  currentContent={activeChapter.content}
                  refreshToken={diffRefreshToken}
                  beforeWrite={flushSaves}
                  onRestored={onChapterRestored}
                />
              )}
            </>
          ) : (
            <div className="empty">No chapter selected. Add one from the sidebar.</div>
          )}
        </div>
      </div>

      <div
        className="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        aria-valuemin={CHAT_MIN}
        aria-valuemax={CHAT_MAX}
        aria-valuenow={chatWidth}
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 16;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const delta = e.key === "ArrowLeft" ? step : -step;
            persistChatWidth(chatWidth + delta);
          }
        }}
      />

      <ChatPanel
        ref={chatRef}
        projectId={project.id}
        activeChapterId={activeId}
        getSelection={getSelection}
        chapters={project.chapters.map((c) => ({
          id: c.id,
          title: c.title,
          order: c.order,
        }))}
        onInsertDraft={insertDraft}
        onTurnComplete={onTurnComplete}
        onUiEvent={onUiEvent}
      />

      {bibleOpen && (
        <StoryBible projectId={project.id} onClose={() => setBibleOpen(false)} />
      )}

      {searchOpen && (
        <SearchPanel
          projectId={project.id}
          onClose={() => setSearchOpen(false)}
          onJump={onSearchJump}
          flushSaves={flushSaves}
          onReplaced={onSearchReplaced}
        />
      )}

      {questionsOpen && (
        <OpenQuestions
          projectId={project.id}
          onClose={() => setQuestionsOpen(false)}
          onAnswer={answerQuestion}
        />
      )}

      {autoWriteOpen && activeChapter && (
        <AutoWrite
          projectId={project.id}
          chapterId={activeChapter.id}
          chapterTitle={activeChapter.title}
          onClose={() => setAutoWriteOpen(false)}
          onApplied={(applied) => {
            const wordCount =
              applied.wordCount ?? countWords(htmlToText(applied.content));
            updateChapterLocal(activeChapter.id, {
              content: applied.content,
              wordCount,
              ...(applied.revision != null ? { revision: applied.revision } : {}),
            });
            const store = optimisticStoreRef.current;
            const local = projectRef.current.chapters.find(
              (c) => c.id === activeChapter.id
            );
            if (store && applied.revision != null) {
              store.setConfirmed(activeChapter.id, {
                content: applied.content,
                title: local?.title ?? activeChapter.title,
                status: local?.status ?? activeChapter.status,
                revision: applied.revision,
                wordCount,
              });
            }
          }}
        />
      )}
    </div>
  );
}
