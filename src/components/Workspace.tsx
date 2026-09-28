"use client";

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopbarMore from "@/components/TopbarMore";
import Editor, { type EditorHandle } from "@/components/Editor";
import ChapterSidebar from "@/components/ChapterSidebar";
import ChatPanel, { type ChatHandle } from "@/components/ChatPanel";
import StoryBible from "@/components/StoryBible";
import StyleAnalysisPanel from "@/components/StyleAnalysisPanel";
import AutoWrite from "@/components/AutoWrite";
import OpenQuestions from "@/components/OpenQuestions";
import DiffView from "@/components/DiffView";
import ExportMenu from "@/components/ExportMenu";
import DictationButton from "@/components/DictationButton";
import ChapterHistory from "@/components/ChapterHistory";
import ReadAloud from "@/components/ReadAloud";
import SearchPanel from "@/components/SearchPanel";
import RepetitionPanel from "@/components/RepetitionPanel";
import OutlineBoard from "@/components/OutlineBoard";
import Presence from "@/components/Presence";
import Scratchpad from "@/components/Scratchpad";
import PreviouslyOn from "@/components/PreviouslyOn";
import StuckPrompts from "@/components/StuckPrompts";
import WeeklyReview from "@/components/WeeklyReview";
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
import { aiInvolvement, chapterWordCount, describeAiInvolvement } from "@/lib/text";
import { listSuggestions } from "@/lib/suggestions";
import { CHAT_WIDTH_MAX, CHAT_WIDTH_MIN } from "@/lib/settings";
import { getFocusMode, setFocusMode, useFocusMode } from "@/lib/focus-mode";
import { MOTION_MS, motionMs, useLeavingIds } from "@/lib/motion";
import { useFocusPhase } from "@/lib/focus-phase";
import { useSnackbar } from "@/components/Snackbar";
import { OptimisticChapterStore, type SaveOutcome } from "@/lib/optimistic-chapter";
import { restoreChapter, saveChapter, type SaveHint } from "@/lib/chapter-save";
import { createHeldWrites } from "@/lib/held-writes";
import { positiveWordDelta } from "@/lib/writing-day";
import { noteWritingStroke, noteWritingWords } from "@/lib/writing-day-client";
import { uploadImport } from "@/lib/import-client";
import type { ReplacedChapter, SearchMatch } from "@/lib/search-client";
import type { ReplaceUndoResult } from "@/components/SearchPanel";
import { makeReplaceUndo } from "@/lib/replace-undo";
import { applyChapterOrder } from "@/lib/outline";
import { fetchShareComments } from "@/lib/share-client";
import type { ShareCommentView } from "@/lib/share-view";
import type { CommentHighlight } from "@/lib/tiptap-comment-highlights";
import {
  KIND_INFO,
  findEntryForDate,
  journalEntryTitle,
  localYmd,
  normalizeKind,
} from "@/lib/manuscript-kind";
import type { Project, Chapter, OpenQuestion, ClientUiEvent } from "@/lib/types";

type SaveState = "saved" | "saving" | SaveHint;

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

// Best-effort tally of an accepted Ciciro suggestion (see src/lib/text.ts).
// Fire-and-forget like recordDraftInsertion in ChatPanel: a dropped call
// under-counts a self-report figure, it does not corrupt the manuscript.
function recordAiAcceptance(chapterId: string, words: number) {
  fetch(`/api/chapters/${chapterId}/ai-involvement`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ acceptedWords: words }),
  }).catch(() => {});
}

export default function Workspace({ initialProject }: { initialProject: Project }) {
  const [project, setProject] = useState<Project>(initialProject);
  const kind = normalizeKind(project.kind);
  const kindInfo = KIND_INFO[kind];
  const [activeId, setActiveId] = useState<string | null>(
    initialProject.chapters[0]?.id ?? null
  );
  const [bibleOpen, setBibleOpen] = useState(false);
  const [styleAnalysisOpen, setStyleAnalysisOpen] = useState(false);
  const [autoWriteOpen, setAutoWriteOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitial, setSearchInitial] = useState<{ query: string; wholeWord: boolean } | null>(null);
  const [repetitionOpen, setRepetitionOpen] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [betaOpen, setBetaOpen] = useState(false);
  const chapterRows = useLeavingIds();
  // A restored chapter's page cross-fades in the next time the editor shows it.
  const [restoredId, setRestoredId] = useState<string | null>(null);
  const notify = useSnackbar();
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [weeklyDue, setWeeklyDue] = useState(false);
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
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reorderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reorderPendingRef = useRef(0);
  const reorderEpochRef = useRef(0);
  const pendingSaveCountRef = useRef(0);
  // Chapters whose typed content the server has not accepted.
  const unsavedContentRef = useRef(new Set<string>());
  // Chapters whose Undo is on its way to the server: read-only until it answers.
  const restoringRef = useRef(new Set<string>());
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  const heldWrites = useMemo(
    () =>
      createHeldWrites<EditorHandle>({
        isHeld: (id) => restoringRef.current.has(id),
        target: (id) => {
          const editor = editorRef.current;
          return id === activeIdRef.current && editor?.isReady() ? editor : null;
        },
      }),
    []
  );
  const writeToEditor = useCallback(
    (write: (editor: EditorHandle) => void) => {
      const id = activeIdRef.current;
      if (id) heldWrites.write(id, write);
    },
    [heldWrites]
  );
  const flushHeldWrites = useCallback(() => heldWrites.flush(), [heldWrites]);
  useEffect(flushHeldWrites, [flushHeldWrites, restoring, activeId, editorNonce]);
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
    focus?: boolean;
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

  const settledSaveState = useCallback((): SaveState => {
    const unsaved = unsavedContentRef.current;
    return projectRef.current.chapters.some((c) => unsaved.has(c.id)) ? "error" : "saved";
  }, []);

  const showTransientSaveState = useCallback(
    (state: SaveHint) => {
      setSaveState(state);
      if (saveStateTimer.current) clearTimeout(saveStateTimer.current);
      saveStateTimer.current = setTimeout(() => {
        if (pendingSaveCountRef.current === 0) setSaveState(settledSaveState());
      }, 3000);
    },
    [settledSaveState]
  );

  const getLocalFields = useCallback((id: string) => {
    const ch = projectRef.current.chapters.find((c) => c.id === id);
    if (!ch) return null;
    return { content: ch.content, title: ch.title, status: ch.status };
  }, []);

  const sendChapter = useCallback(
    (chapterId: string, body: object) =>
      fetch(`/api/chapters/${chapterId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    []
  );

  /** Run a chapter save behind every save already queued, with the indicator showing it. */
  const enqueueSave = useCallback(
    (task: () => Promise<SaveOutcome>): Promise<SaveOutcome> => {
      if (saveStateTimer.current) clearTimeout(saveStateTimer.current);
      pendingSaveCountRef.current += 1;
      setSaveState("saving");
      const save = saveQueueRef.current
        .catch(() => {})
        .then(task)
        .finally(() => {
          pendingSaveCountRef.current -= 1;
          if (pendingSaveCountRef.current === 0) {
            setSaveState((s) => (s === "saving" ? settledSaveState() : s));
          }
        });
      saveQueueRef.current = save.then(() => {});
      return save.catch((): SaveOutcome => "failed");
    },
    [settledSaveState]
  );

  const patchChapter = useCallback(
    (id: string, fields: Partial<Pick<Chapter, "content" | "title" | "status">>): Promise<SaveOutcome> =>
      enqueueSave(async () => {
        const { outcome, settled } = await saveChapter(
          {
            store: optimisticStoreRef.current!,
            send: sendChapter,
            getLocalFields,
            updateChapterLocal,
            showHint: showTransientSaveState,
          },
          id,
          fields
        );
        if ("content" in fields) {
          if (settled) unsavedContentRef.current.delete(id);
          else unsavedContentRef.current.add(id);
        }
        return outcome;
      }),
    [enqueueSave, sendChapter, updateChapterLocal, getLocalFields, showTransientSaveState]
  );

  // --- Content autosave (debounced) ---
  const onContentChange = useCallback(
    (html: string) => {
      if (!activeId || restoringRef.current.has(activeId)) return;
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
      setRestoredId(chapter.id);
      unsavedContentRef.current.delete(chapter.id);
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

  const subtitleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSubtitleChange = useCallback(
    (logline: string) => {
      setProject((p) => ({ ...p, logline }));
      if (subtitleTimer.current) clearTimeout(subtitleTimer.current);
      subtitleTimer.current = setTimeout(() => {
        void fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ logline }),
        });
      }, 700);
    },
    [project.id]
  );

  const onTitleChange = useCallback(
    (title: string) => {
      if (!activeId) return;
      updateChapterLocal(activeId, { title });
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        patchChapter(activeId, { title });
        // A blog post has one title: the piece's, shown on the shelf and in exports.
        if (kind === "blog") {
          setProject((p) => ({ ...p, title }));
          void fetch(`/api/projects/${project.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title }),
          });
        }
      }, 700);
    },
    [activeId, kind, patchChapter, project.id, updateChapterLocal]
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
        setSearchInitial(null);
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Focus and typewriter mode ---
  const focusMode = useFocusMode();
  const focusPhase = useFocusPhase(focusMode);
  const editorInnerRef = useRef<HTMLDivElement>(null);
  const innerLeft = useRef<{ left: number; collapsed: boolean } | null>(null);
  // The exit hint shows while the pointer moves, and fades 2s after it stops.
  const [hintVisible, setHintVisible] = useState(true);
  useEffect(() => {
    if (focusPhase !== "on") return;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      setHintVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setHintVisible(false), 2000);
    };
    show();
    window.addEventListener("pointermove", show);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", show);
    };
  }, [focusPhase]);
  // When the chrome goes, the page glides to the middle of the window (and
  // back), rather than jumping the moment the columns collapse.
  useLayoutEffect(() => {
    const el = editorInnerRef.current;
    if (!el) return;
    const at = { left: el.getBoundingClientRect().left, collapsed: focusPhase === "on" };
    const was = innerLeft.current;
    innerLeft.current = at;
    const wait = motionMs(MOTION_MS.focus);
    if (!was || was.collapsed === at.collapsed || wait === 0) return;
    if (Math.abs(was.left - at.left) < 1 || typeof el.animate !== "function") return;
    el.animate(
      [{ transform: `translateX(${was.left - at.left}px)` }, { transform: "none" }],
      { duration: wait, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }, [focusPhase]);
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = bibleOpen || searchOpen || repetitionOpen || questionsOpen || autoWriteOpen;
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

  useEffect(() => {
    if (!restoredId || viewMode !== "prose") return;
    const timer = setTimeout(() => setRestoredId(null), MOTION_MS.accordion + 100);
    return () => clearTimeout(timer);
  }, [restoredId, viewMode]);

  const onSearchReplaced = useCallback(
    (replaced: ReplacedChapter[]): (() => Promise<ReplaceUndoResult>) => {
      const store = optimisticStoreRef.current;
      const applyChapter = (
        id: string,
        next: { content: string; wordCount: number; revision: number }
      ) => {
        const local = projectRef.current.chapters.find((c) => c.id === id);
        store?.setConfirmed(id, {
          ...next,
          title: local?.title ?? "",
          status: local?.status ?? "draft",
        });
        updateChapterLocal(id, next);
      };
      // What each chapter said before, for Undo. The search saved every edit
      // first, so this is what the server held.
      const before = replaced.map((r) => ({
        id: r.id,
        content: projectRef.current.chapters.find((c) => c.id === r.id)?.content ?? null,
        revision: r.revision,
      }));
      for (const r of replaced) applyChapter(r.id, r);
      const remount = (ids: string[]) => {
        const active = activeIdRef.current;
        if (active && ids.includes(active)) {
          const editor = editorRef.current;
          const caret = editor?.getCaret();
          setFocusEndOnMount(false);
          setResumePosition(caret ? { chapterId: active, ...caret, focus: editor?.hasFocus() ?? false } : null);
          setEditorNonce((n) => n + 1);
        }
      };
      remount(replaced.map((r) => r.id));
      return makeReplaceUndo(before, {
        flushSaves,
        currentRevision: (id) => optimisticStoreRef.current?.getExpectedRevision(id),
        // The normal save path: queued behind other saves, on the store's revision.
        restore: (id, content) =>
          enqueueSave(() =>
            restoreChapter(
              { store: optimisticStoreRef.current!, send: sendChapter, updateChapterLocal },
              id,
              content
            )
          ),
        hold: (ids) => {
          for (const id of ids) restoringRef.current.add(id);
          setRestoring(new Set(restoringRef.current));
          return () => {
            for (const id of ids) restoringRef.current.delete(id);
            setRestoring(new Set(restoringRef.current));
          };
        },
        show: remount,
      });
    },
    [enqueueSave, flushSaves, sendChapter, updateChapterLocal]
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

  // --- Repetition ---
  const onInspectRepetition = useCallback((text: string) => {
    setRepetitionOpen(false);
    setSearchInitial({ query: text, wholeWord: true });
    setSearchOpen(true);
  }, []);

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
    // A journal's "new entry" is today's: open it if it is already there.
    const today = localYmd();
    if (kind === "journal") {
      const existing = findEntryForDate(project.chapters, today);
      if (existing) {
        setFocusEndOnMount(true);
        setActiveId(existing.id);
        return;
      }
    }
    const res = await fetch("/api/chapters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        ...(kind === "journal" ? { title: journalEntryTitle(today) } : {}),
      }),
    });
    if (!res.ok) return;
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

  // Only empty chapters can be deleted, so nothing is at stake: the chapter
  // slides out, a snackbar offers Undo, and the server hears about it after.
  function deleteChapter(id: string) {
    const chapter = projectRef.current.chapters.find((c) => c.id === id);
    if (!chapter) return;
    const name = chapter.title.trim() || "Untitled";
    const wasActive = activeId === id;
    if (wasActive) {
      const next = projectRef.current.chapters.find((c) => c.id !== id && !chapterRows.hidden.has(c.id));
      setActiveId(next?.id ?? null);
    }
    void chapterRows.leave(id);
    notify({
      message: `Deleted "${name}"`,
      actionLabel: "Undo",
      onAction: () => {
        chapterRows.restore(id);
        if (wasActive) setActiveId(id);
      },
      onCommit: async () => {
        const res = await fetch(`/api/chapters/${id}`, { method: "DELETE", keepalive: true }).catch(
          () => null
        );
        if (!res?.ok) {
          const err = (await res?.json().catch(() => null)) as { error?: string } | null;
          chapterRows.restore(id);
          notify({ message: err?.error || "Couldn't delete that chapter." });
          return;
        }
        unsavedContentRef.current.delete(id);
        setProject((p) => {
          const chapters = p.chapters
            .filter((c) => c.id !== id)
            .map((c, i) => ({ ...c, order: i }));
          return { ...p, chapters };
        });
        chapterRows.forget(id);
      },
    });
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
    writeToEditor((editor) => editor.insertDraft(text, key));
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
        if (evt.aiDraftedWords != null) {
          updateChapterLocal(evt.chapterId, { aiDraftedWords: evt.aiDraftedWords });
        }
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
      className={`workspace${resizing ? " resizing" : ""}${focusPhase === "on" ? " focus-mode" : ""}${
        focusPhase === "entering" || focusPhase === "leaving" ? " focus-entering" : ""
      }${
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
          {activeId && restoring.has(activeId)
            ? "Restoring..."
            : saveState === "saving"
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
        <DictationButton
          resetKey={`${activeChapter?.id ?? ""}:${viewMode}`}
          onPhrase={(text, lang) => writeToEditor((editor) => editor.insertDictation(text, lang))}
        />
        <button
          className="btn small"
          onClick={() => {
            setSearchInitial(null);
            setSearchOpen(true);
          }}
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
        <TopbarMore
          items={[
            {
              key: "questions",
              label: "Questions",
              count: openCount,
              onSelect: () => setQuestionsOpen(true),
            },
            { key: "bible", label: "Story bible", onSelect: () => setBibleOpen(true) },
            {
              key: "style-analysis",
              label: "Analyze my style",
              title: "Draft a proposed style.md and character Voice sections from your own chapters",
              onSelect: () => setStyleAnalysisOpen(true),
            },
            {
              key: "repetition",
              label: "Repetition",
              title: "Overused words and phrases, per chapter and across the manuscript",
              onSelect: () => setRepetitionOpen(true),
            },
            { key: "scratchpad", label: "Scratchpad", onSelect: () => setScratchOpen(true) },
            {
              key: "weekly",
              label: "Weekly review",
              title: "How your week went, loose ends, and what to write next",
              dot: weeklyDue,
              onSelect: () => setWeeklyOpen(true),
            },
            {
              key: "beta",
              label: "Beta readers",
              title: "Share read-only links and see what beta readers said",
              count: readerComments.length,
              onSelect: () => {
                setFocusCommentId(null);
                setBetaOpen(true);
              },
            },
          ]}
        />
        <WeeklyReview
          projectId={project.id}
          open={weeklyOpen}
          onOpenChange={setWeeklyOpen}
          onDueChange={setWeeklyDue}
        />
        <ExportMenu projectId={project.id} chapters={project.chapters} />
      </div>

      <ChapterSidebar
        chapters={project.chapters.filter((c) => !chapterRows.hidden.has(c.id))}
        leavingIds={chapterRows.leaving}
        activeId={activeId}
        onSelect={(id) => {
          setFocusEndOnMount(false);
          setActiveId(id);
        }}
        onAdd={addChapter}
        onDelete={deleteChapter}
        onImport={importChapters}
        kind={kind}
      />

      {focusPhase === "on" && (
        <div className={`focus-exit${hintVisible ? " visible" : ""}`}>
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
        <div className="editor-inner" ref={editorInnerRef}>
          <PreviouslyOn projectId={project.id} />
          {activeChapter ? (
            <>
              <input
                className="editor-title"
                value={activeChapter.title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder={
                  kind === "blog"
                    ? "Title"
                    : kind === "journal"
                      ? "Entry date"
                      : `${kindInfo.unit} title`
                }
                spellCheck={settings.autoCorrect}
              />
              {kind === "blog" ? (
                <input
                  className="subtitle-input"
                  aria-label="Subtitle"
                  value={project.logline}
                  onChange={(e) => onSubtitleChange(e.target.value)}
                  placeholder="Subtitle"
                  spellCheck={settings.autoCorrect}
                />
              ) : null}
              <div className="editor-meta">
                <span>{activeChapter.wordCount.toLocaleString()} words</span>
                {(() => {
                  const involvement = aiInvolvement(activeChapter);
                  if (involvement.ciciroWords === 0) return null;
                  const since = involvement.since ? involvement.since.toLocaleDateString() : null;
                  return (
                    <>
                      <span>-</span>
                      <span
                        className="ai-involvement-badge"
                        title={
                          `${describeAiInvolvement(involvement)}` +
                          (since ? ` since ${since}` : "") +
                          ". A running total of what you accepted or Ciciro inserted (auto-draft, " +
                          "Continue writing), counted once at that moment; a later edit or deletion " +
                          "doesn't lower it, so it is not a share of the chapter's current words. " +
                          "A self-report for your own disclosure, not a compliance guarantee."
                        }
                      >
                        {involvement.ciciroWords.toLocaleString()} from Ciciro
                      </span>
                    </>
                  );
                })()}
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
                {kind !== "journal" ? (
                  <>
                    <button
                      className="btn ghost small"
                      onClick={() => setAutoWriteOpen(true)}
                      title="Let Ciciro draft this chapter autonomously"
                    >
                      Auto-draft
                    </button>
                    <span>-</span>
                  </>
                ) : null}
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
                  onAcceptAll={() => writeToEditor((editor) => editor.resolveSuggestions("accept"))}
                  onRejectAll={() => writeToEditor((editor) => editor.resolveSuggestions("reject"))}
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
                          focus: resumePosition.focus,
                        }
                      : null
                  }
                  focusEndOnMount={focusEndOnMount}
                  fadeIn={restoredId === activeChapter.id}
                  suggesting={suggesting}
                  suggestionAuthor={suggestionAuthor}
                  onActiveSuggestionChange={setActiveSuggestionId}
                  commentHighlights={commentHighlights}
                  onCommentClick={openReaderComment}
                  kind={kind}
                  readOnly={restoring.has(activeChapter.id)}
                  onReady={flushHeldWrites}
                  onSuggestionsAccepted={(words) => {
                    const id = activeIdRef.current;
                    if (!id) return;
                    const prior =
                      projectRef.current.chapters.find((c) => c.id === id)?.aiAcceptedWords ?? 0;
                    updateChapterLocal(id, { aiAcceptedWords: prior + words });
                    recordAiAcceptance(id, words);
                  }}
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
        onDraftTallied={(chapterId, aiDraftedWords) =>
          updateChapterLocal(chapterId, { aiDraftedWords })
        }
        kind={kind}
        onTurnComplete={onTurnComplete}
        onUiEvent={onUiEvent}
      />

      <Presence open={outlineOpen} exitMs={MOTION_MS.dialogOut}>
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
      </Presence>

      <Presence open={bibleOpen}>
        <StoryBible projectId={project.id} onClose={() => setBibleOpen(false)} />
      </Presence>

      <Presence open={styleAnalysisOpen}>
        <StyleAnalysisPanel projectId={project.id} onClose={() => setStyleAnalysisOpen(false)} />
      </Presence>

      <Presence open={repetitionOpen}>
        <RepetitionPanel
          projectId={project.id}
          activeChapterId={activeId}
          onClose={() => setRepetitionOpen(false)}
          onInspect={onInspectRepetition}
        />
      </Presence>

      <Presence open={scratchOpen}>
        <Scratchpad projectId={project.id} onClose={() => setScratchOpen(false)} />
      </Presence>

      <Presence open={betaOpen}>
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
      </Presence>

      <Presence open={searchOpen}>
        <SearchPanel
          projectId={project.id}
          onClose={() => setSearchOpen(false)}
          onJump={onSearchJump}
          flushSaves={flushSaves}
          onReplaced={onSearchReplaced}
          initialQuery={searchInitial?.query}
          initialWholeWord={searchInitial?.wholeWord}
        />
      </Presence>

      <Presence open={questionsOpen}>
        <OpenQuestions
          projectId={project.id}
          onClose={() => setQuestionsOpen(false)}
          onAnswer={answerQuestion}
        />
      </Presence>

      <Presence open={autoWriteOpen && Boolean(activeChapter)}>
        {activeChapter ? (
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
        ) : null}
      </Presence>
    </div>
  );
}
