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
import ThemePicker from "@/components/ThemePicker";
import { countWords, htmlToText } from "@/lib/text";
import { OptimisticChapterStore, handleNetworkFailure } from "@/lib/optimistic-chapter";
import type { Project, Chapter, OpenQuestion, ClientUiEvent } from "@/lib/types";

type SaveState = "saved" | "saving" | "error" | "restored";

const CHAT_MIN = 280;
const CHAT_MAX = 720;
const CHAT_WIDTH_KEY = "ciciro-chat-width";
const DEFAULT_CHAT_WIDTH = 380;

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
  const [openCount, setOpenCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [viewMode, setViewMode] = useState<"prose" | "diff">("prose");
  const [diffRefreshToken, setDiffRefreshToken] = useState(0);
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
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
  const saveStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the editor opens/creates a chapter, mount TipTap with the caret at
  // the end so Auto-mode drafts continue rather than prepending.
  const [focusEndOnMount, setFocusEndOnMount] = useState(false);
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_WIDTH_KEY);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n)) setChatWidth(clampChatWidth(n));
    } catch {
      /* ignore */
    }
  }, []);

  const persistChatWidth = useCallback((w: number) => {
    try {
      localStorage.setItem(CHAT_WIDTH_KEY, String(w));
    } catch {
      /* ignore */
    }
  }, []);

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
        setChatWidth(latest);
      }
      function onUp(ev: PointerEvent) {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        setResizing(false);
        persistChatWidth(latest);
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

          let payload = { ...inFlight };
          let outcome = await attemptSave(payload);
          if (outcome === "fail") {
            outcome = await attemptSave(payload);
          } else if (outcome === "409-retry") {
            outcome = await attemptSave(payload);
            if (outcome === "409-retry") {
              outcome = await attemptSave(payload);
            }
          }
          if (outcome === "fail") {
            const confirmed = store.get(id);
            const local = getLocalFields(id);
            if (confirmed && local) {
              const failure = handleNetworkFailure(confirmed, local, payload);
              if (failure.localPatch) updateChapterLocal(id, failure.localPatch);
              showTransientSaveState(failure.uiHint);
            } else {
              showTransientSaveState("error");
            }
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
      updateChapterLocal(activeId, {
        content: html,
        wordCount: countWords(htmlToText(html)),
      });
      if (contentTimer.current) clearTimeout(contentTimer.current);
      contentTimer.current = setTimeout(() => {
        patchChapter(activeId, { content: html });
      }, 1000);
    },
    [activeId, patchChapter, updateChapterLocal]
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

  async function deleteChapter(id: string) {
    await fetch(`/api/chapters/${id}`, { method: "DELETE" });
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
        <button className="btn small" onClick={() => setQuestionsOpen(true)}>
          Questions{openCount ? ` (${openCount})` : ""}
        </button>
        <button className="btn small" onClick={() => setBibleOpen(true)}>
          Story bible
        </button>
        <a className="btn small primary" href={`/api/export/${project.id}`}>
          Export .docx
        </a>
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
                </div>
              </div>
              {viewMode === "prose" ? (
                <Editor
                  key={activeChapter.id}
                  ref={editorRef}
                  content={activeChapter.content}
                  onChange={onContentChange}
                  focusEndOnMount={focusEndOnMount}
                />
              ) : (
                <DiffView chapterId={activeChapter.id} refreshToken={diffRefreshToken} />
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
            setChatWidth((w) => {
              const next = clampChatWidth(w + delta);
              persistChatWidth(next);
              return next;
            });
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
