"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import ReadAloud from "@/components/ReadAloud";
import SearchPanel from "@/components/SearchPanel";
import OutlineBoard from "@/components/OutlineBoard";
import Scratchpad from "@/components/Scratchpad";
import PreviouslyOn from "@/components/PreviouslyOn";
import StuckPrompts from "@/components/StuckPrompts";
import BetaReaders, { type BetaReadersTab } from "@/components/BetaReaders";
import ThemePicker from "@/components/ThemePicker";
import WritingMeter from "@/components/WritingMeter";
import ManuscriptPaceMeter from "@/components/ManuscriptPaceMeter";
import {
  SuggestModeToggle,
  SuggestionBar,
  useSuggestionAuthor,
} from "@/components/TrackChanges";
import { useSettings } from "@/components/SettingsProvider";
import { chapterWordCount } from "@/lib/text";
import { listSuggestions } from "@/lib/suggestions";
import { CHAT_WIDTH_MAX, CHAT_WIDTH_MIN } from "@/lib/settings";
import { getFocusMode, setFocusMode, useFocusMode } from "@/lib/focus-mode";
import { OptimisticChapterStore, handleNetworkFailure } from "@/lib/optimistic-chapter";
import { positiveWordDelta } from "@/lib/writing-day";
import { noteWritingStroke, noteWritingWords } from "@/lib/writing-day-client";
import { uploadImport } from "@/lib/import-client";
import type { ReplacedChapter, SearchMatch } from "@/lib/search-client";
import { applyChapterOrder } from "@/lib/outline";
import { fetchShareComments } from "@/lib/share-client";
import type { ShareCommentView } from "@/lib/share-view";
import type { CommentHighlight } from "@/lib/tiptap-comment-highlights";
import type { Project, Chapter, OpenQuestion, ClientUiEvent } from "@/lib/types";

type SaveState = "saved" | "saving" | "error" | "restored";

const SUGGESTING_KEY = "ciciro-suggesting";

function readSuggesting(): boolean {
  try {
    return window.localStorage.getItem(SUGGESTING_KEY) === "1";
  } catch {
    return false;
  }
}

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
  const [scratchOpen, setScratchOpen] = useState(false);
  const [betaOpen, setBetaOpen] = useState(false);
  const [betaTab, setBetaTab] = useState<BetaReadersTab>("comments");
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  // Open beta reader comments: the topbar count and the marks in the editor.
  const [readerComments, setReaderComments] = useState<ShareCommentView[]>([]);
  // Bumped to remount the editor when its chapter was rewritten from outside.
  const [editorNonce, setEditorNonce] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [viewMode, setViewMode] = useState<"prose" | "diff" | "history">("prose");
  const [diffRefreshToken, setDiffRefreshToken] = useState(0);
  const { settings, patch } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [dragChatWidth, setDragChatWidth] = useState<number | null>(null);
  const chatWidth = dragChatWidth ?? settings.chatWidth;
  const [resizing, setResizing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const suggestionAuthor = useSuggestionAuthor(initialProject.author);

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
  const reorderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reorderPendingRef = useRef(0);
  const reorderEpochRef = useRef(0);
  const pendingSaveCountRef = useRef(0);
  // Chapters whose typed content the server has not accepted.
  const unsavedContentRef = useRef(new Set<string>());
  const saveStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the editor opens/creates a chapter, mount TipTap with the caret at
  // the end so Auto-mode drafts continue rather than prepending.
  const [focusEndOnMount, setFocusEndOnMount] = useState(false);
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<{ id: string; html: string } | null>(null);
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

  // Suggest mode is a per-device habit, like a text editor's track-changes switch.
  useEffect(() => {
    setSuggesting(readSuggesting());
  }, []);
  const changeSuggesting = useCallback((next: boolean) => {
    setSuggesting(next);
    try {
      window.localStorage.setItem(SUGGESTING_KEY, next ? "1" : "0");
    } catch {
      /* private window */
    }
  }, []);
  const reviewContent = useDeferredValue(activeChapter?.content ?? "");
  const suggestions = useMemo(() => listSuggestions(reviewContent), [reviewContent]);

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
      const nextWords = chapterWordCount(html);
      noteWritingWords(positiveWordDelta(prevWords, nextWords));
      updateChapterLocal(activeId, {
        content: html,
        wordCount: nextWords,
      });
      const pending = pendingContentRef.current;
      if (contentTimer.current) clearTimeout(contentTimer.current);
      if (pending && pending.id !== activeId) patchChapter(pending.id, { content: pending.html });
      pendingContentRef.current = { id: activeId, html };
      contentTimer.current = setTimeout(() => {
        contentTimer.current = null;
        pendingContentRef.current = null;
        patchChapter(activeId, { content: html });
      }, 1000);
    },
    [activeId, patchChapter, updateChapterLocal]
  );

  /**
   * Send any debounced typing now and wait for every queued save to land.
   * `chapterId` limits the check to one chapter (a single replace); omitted,
   * every chapter is in scope. Resolves false when text in scope is still
   * missing from the server, so a restore or replace cannot overwrite it.
   */
  const flushSaves = useCallback(
    async (chapterId?: string): Promise<boolean> => {
      const pending = pendingContentRef.current;
      if (contentTimer.current) clearTimeout(contentTimer.current);
      contentTimer.current = null;
      pendingContentRef.current = null;
      if (pending) patchChapter(pending.id, { content: pending.html });

      let queue: Promise<void>;
      do {
        queue = saveQueueRef.current;
        await queue.catch(() => {});
      } while (queue !== saveQueueRef.current);

      if (pendingSaveCountRef.current > 0) return false;

      const unsaved = unsavedContentRef.current;
      const store = optimisticStoreRef.current;
      return !projectRef.current.chapters.some((chapter) => {
        if (chapterId && chapter.id !== chapterId) return false;
        if (unsaved.has(chapter.id)) return true;
        const local = getLocalFields(chapter.id);
        return Boolean(local && store?.hasLocalEdits(chapter.id, local));
      });
    },
    [getLocalFields, patchChapter]
  );

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

  // --- Focus and typewriter mode ---
  const focusMode = useFocusMode();
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = bibleOpen || searchOpen || questionsOpen || autoWriteOpen;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        setFocusMode(!getFocusMode());
      } else if (mod && e.altKey && e.code === "KeyT") {
        e.preventDefault();
        patch({ typewriterMode: !settingsRef.current.typewriterMode });
      } else if (
        // Not gated on defaultPrevented: ProseMirror prevents every Escape typed in
        // the editor. Overlays claim their Escape with stopPropagation instead.
        e.key === "Escape" &&
        getFocusMode() &&
        !overlayOpenRef.current &&
        !document.querySelector('[role="dialog"], [aria-modal="true"]')
      ) {
        setFocusMode(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [patch]);

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

  // --- Beta reader comments ---
  const refreshReaderComments = useCallback(() => {
    fetchShareComments(project.id, "open")
      .then(setReaderComments)
      .catch(() => {});
  }, [project.id]);

  useEffect(() => {
    refreshReaderComments();
    window.addEventListener("focus", refreshReaderComments);
    return () => window.removeEventListener("focus", refreshReaderComments);
  }, [refreshReaderComments]);

  const commentHighlights = useMemo<CommentHighlight[]>(
    () =>
      readerComments
        .filter((c) => c.chapterId === activeId && c.anchor && c.anchor.length > 0)
        .map((c) => ({
          id: c.id,
          blockId: c.anchor!.blockId,
          quote: c.quote,
          offset: c.anchor!.offset,
          title: `${c.readerName}: ${c.body}`,
        })),
    [readerComments, activeId]
  );

  const openReaderComment = useCallback((id: string) => {
    setFocusCommentId(id);
    setBetaTab("comments");
    setBetaOpen(true);
  }, []);

  const closeBetaReaders = useCallback(() => {
    setBetaOpen(false);
    refreshReaderComments();
  }, [refreshReaderComments]);

  const onCommentJump = useCallback(
    (comment: ShareCommentView) => {
      if (!comment.anchor) return;
      setBetaOpen(false);
      setViewMode("prose");
      setFocusEndOnMount(false);
      setResumePosition({ chapterId: comment.chapterId, ...comment.anchor });
      setActiveId(comment.chapterId);
      if (comment.chapterId === activeId) setEditorNonce((n) => n + 1);
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

  // Fold the server's chapters in, keeping what the author is typing. The
  // server's order only wins when no local reorder is pending or newer.
  function mergeServerChapters(remote: Chapter[], takeOrder: boolean) {
    setProject((p) => {
      const remoteById = new Map(remote.map((c) => [c.id, c]));
      const localIds = new Set(p.chapters.map((c) => c.id));
      const merged = [
        ...p.chapters.map((cur) => {
          const nc = remoteById.get(cur.id);
          return nc ? { ...cur, summary: nc.summary } : cur;
        }),
        ...remote.filter((nc) => !localIds.has(nc.id)),
      ];
      const ids = takeOrder ? remote.map((c) => c.id) : p.chapters.map((c) => c.id);
      return { ...p, chapters: applyChapterOrder(merged, ids) };
    });
  }

  // Pull the server's order and beat summaries so the outline is current.
  async function refreshOutline() {
    const epoch = reorderEpochRef.current;
    try {
      const res = await fetch(`/api/chapters?projectId=${encodeURIComponent(projectRef.current.id)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const remote = (await res.json()) as Chapter[];
      mergeServerChapters(
        remote,
        epoch === reorderEpochRef.current && reorderPendingRef.current === 0
      );
    } catch {
      /* the outline still works from what we have */
    }
  }

  // Reorders go out one at a time so the server ends on the latest order.
  function reorderChapters(ids: string[]) {
    reorderEpochRef.current += 1;
    reorderPendingRef.current += 1;
    setProject((p) => ({ ...p, chapters: applyChapterOrder(p.chapters, ids) }));
    const projectId = projectRef.current.id;
    reorderQueueRef.current = reorderQueueRef.current.then(async () => {
      let saved: Chapter[] | null = null;
      try {
        const res = await fetch("/api/chapters/reorder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, chapterIds: ids }),
        });
        if (res.ok) saved = (await res.json()) as Chapter[];
      } catch {
        saved = null;
      }
      reorderPendingRef.current -= 1;
      const settled = reorderPendingRef.current === 0;
      if (saved) {
        if (settled) mergeServerChapters(saved, true);
        return;
      }
      window.alert("Couldn't reorder the chapters. Try again.");
      if (settled) await refreshOutline();
    });
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
      className={`workspace${resizing ? " resizing" : ""}${focusMode ? " focus-mode" : ""}${
        settings.typewriterMode ? " typewriter" : ""
      }`}
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
          className={`btn small${settings.typewriterMode ? " primary" : ""}`}
          aria-pressed={settings.typewriterMode}
          onClick={() => patch({ typewriterMode: !settings.typewriterMode })}
          title="Keep the line you are writing centered (Cmd/Ctrl+Alt+T)"
        >
          Typewriter
        </button>
        <button
          className="btn small"
          onClick={() => setFocusMode(true)}
          title="Hide everything but the page (Cmd/Ctrl+Shift+Enter, Esc to leave)"
        >
          Focus
        </button>
        <ReadAloud
          editorRef={editorRef}
          resetKey={`${activeChapter?.id ?? ""}:${editorNonce}`}
          disabled={viewMode !== "prose"}
        />
        <button
          className="btn small"
          onClick={() => setSearchOpen(true)}
          title="Find and replace across every chapter (Cmd/Ctrl+Shift+F)"
        >
          Search
        </button>
        <button
          className="btn small"
          onClick={() => {
            setOutlineOpen(true);
            void refreshOutline();
          }}
        >
          Outline
        </button>
        <button className="btn small" onClick={() => setQuestionsOpen(true)}>
          Questions{openCount ? ` (${openCount})` : ""}
        </button>
        <button className="btn small" onClick={() => setBibleOpen(true)}>
          Story bible
        </button>
        <button className="btn small" onClick={() => setScratchOpen(true)}>
          Scratchpad
        </button>
        <button
          className="btn small"
          onClick={() => {
            setFocusCommentId(null);
            setBetaOpen(true);
          }}
          title="Share read-only links and see what beta readers said"
        >
          Beta readers{readerComments.length ? ` (${readerComments.length})` : ""}
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

      {focusMode && (
        <div className="focus-exit">
          <button
            className={`btn ghost small${settings.typewriterMode ? " primary" : ""}`}
            aria-pressed={settings.typewriterMode}
            onClick={() => patch({ typewriterMode: !settings.typewriterMode })}
          >
            Typewriter
          </button>
          <button className="btn ghost small" onClick={() => setFocusMode(false)}>
            Exit focus (Esc)
          </button>
        </div>
      )}

      <div className="editor-pane">
        <div className="editor-inner">
          <PreviouslyOn projectId={project.id} />
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
                <span>-</span>
                <StuckPrompts
                  projectId={project.id}
                  chapterId={activeChapter.id}
                  onUse={(prompt) => chatRef.current?.offer(prompt)}
                />
                {viewMode === "prose" ? (
                  <SuggestModeToggle suggesting={suggesting} onChange={changeSuggesting} />
                ) : null}
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
                <SuggestionBar
                  suggestions={suggestions}
                  activeId={activeSuggestionId}
                  onReveal={(id) => editorRef.current?.revealSuggestion(id)}
                  onAcceptAll={() => editorRef.current?.resolveSuggestions("accept")}
                  onRejectAll={() => editorRef.current?.resolveSuggestions("reject")}
                />
              ) : null}
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
                  suggesting={suggesting}
                  suggestionAuthor={suggestionAuthor}
                  onActiveSuggestionChange={setActiveSuggestionId}
                  commentHighlights={commentHighlights}
                  onCommentClick={openReaderComment}
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

      {outlineOpen && (
        <OutlineBoard
          chapters={project.chapters}
          activeId={activeId}
          onOpen={(id) => {
            setFocusEndOnMount(false);
            setActiveId(id);
          }}
          onReorder={reorderChapters}
          onStatusChange={(id, status) => {
            updateChapterLocal(id, { status });
            patchChapter(id, { status });
          }}
          onClose={() => setOutlineOpen(false)}
        />
      )}

      {bibleOpen && (
        <StoryBible projectId={project.id} onClose={() => setBibleOpen(false)} />
      )}

      {scratchOpen && (
        <Scratchpad projectId={project.id} onClose={() => setScratchOpen(false)} />
      )}

      {betaOpen && (
        <BetaReaders
          projectId={project.id}
          chapters={project.chapters.filter((c) => !c.archivedAt)}
          activeChapterId={activeId}
          tab={betaTab}
          onTabChange={setBetaTab}
          focusCommentId={focusCommentId}
          onJump={onCommentJump}
          onCommentsChanged={refreshReaderComments}
          onClose={closeBetaReaders}
        />
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
              applied.wordCount ?? chapterWordCount(applied.content);
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
