import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as haptics from "../../../../lib/haptics";
import { announce } from "../../../../lib/announce";
import type { EnrichedTextInputInstance, OnChangeStateEvent } from "react-native-enriched-html";
import {
  ChapterEditor,
  kindFromEnrichedState,
  marksFromEnrichedState,
  type EditorStyle,
} from "../../../../components/ChapterEditor";
import { useAppHeaderHeight } from "../../../../components/AppHeader";
import { FormatBar, type FormatBlockKind } from "../../../../components/FormatBar";
import { ScreenplayBar } from "../../../../components/ScreenplayBar";
import { knownElement, normalizeKind, type ScreenplayElement } from "../../../../lib/manuscript-kind";
import { caretBeyondChapter, elementTagAtCaret, elementTargetId } from "../../../../lib/screenplay-live";
import { FormatBubble } from "../../../../components/FormatBubble";
import { FormatPressMenu } from "../../../../components/FormatPressMenu";
import { GrammarPopup } from "../../../../components/GrammarPopup";
import { ReaderCommentsPill, useChapterReaderCommentCount } from "../../../../components/ReaderCommentsPill";
import { useTabBarClearance } from "../../../../components/ManuscriptTabBar";
import { ChapterTitleBar } from "../../../../components/ChapterTitleBar";
import { ProjectLoadError } from "../../../../components/ProjectLoadError";
import { ScreenErrorBoundary } from "../../../../components/ScreenErrorBoundary";
import { SkeletonList } from "../../../../components/Skeleton";
import { SuggestionsPill, SuggestionsSheet } from "../../../../components/SuggestionsReview";
import { ciciro } from "../../../../lib/api";
import type { SyncOp } from "../../../../lib/api/types";
import { getAnalytics } from "../../../../lib/analytics-client";
import {
  applyOpsToDoc,
  CARET_FLUSH_MS,
  REPLACE_FLUSH_MS,
  replaceBlockOps,
  appendEmptyBlockOps,
  setBlockElementOps,
  speechOfBlock,
  toggleDualOps,
  emptyBlockMarks,
  type BlockMark,
} from "../../../../lib/block-editor";
import {
  freezeResumePlace,
  reuseUnchangedBlocks,
  sameLocalDoc,
} from "../../../../lib/editor-session";
import {
  blockAtPlainOffset,
  blockIsAbovePlainOffset,
  blockSkipsProofreading,
  fromEnrichedHtmlAsShown,
  opsFromEnrichedHtml,
  restampCiciroHtml,
  toEnrichedHtml,
} from "../../../../lib/enriched-html";
import {
  diffHtmlToOps,
  docToHtml,
  htmlToDoc,
  resumePlainTextIndex,
  type ManuscriptBlock,
  type ManuscriptOp,
} from "../../../../lib/manuscript";
import {
  acceptedCorrection,
  caretAfterCorrection,
  GrammarLoop,
  GRAMMAR_IDLE_MS,
  selectPopupSpan,
  type GrammarSuggestion,
} from "../../../../lib/grammar";
import { dictationLocale, insertDictation } from "../../../../lib/dictation";
import { SELECTION_ACTION_PARAM } from "../../../../lib/ciciro-intents";
import { replaceSelectedWord } from "../../../../lib/selection-edit";
import type { SelectionActionId } from "../../../../lib/selection-menu";
import { useSelectionMenu } from "../../../../lib/use-selection-menu";
import { useDictation, type DictationError } from "../../../../lib/speech";
import { useProject } from "../../../../lib/project";
import { useScriptLayout } from "../../../../lib/script-layout";
import { useScriptLanguageSupported } from "../../../../lib/script-language";
import { useRenameChapter } from "../../../../lib/use-rename-chapter";
import { FOCUS_TRANSITION_MS, useFocusMode } from "../../../../lib/focus-mode";
import { blockHasSuggestions } from "../../../../lib/suggestion-review";
import {
  ciciroAcceptedWordCount,
  listSuggestions,
  resolveSuggestions,
  type SuggestionAction,
} from "../../../../lib/suggestions";
import { setReadAloudSelection } from "../../../../lib/read-aloud";
import { blocksPlainText } from "../../../../lib/read-aloud-text";
import { TapPressable } from "../../../../components/TapPressable";
import { useAppTheme } from "../../../../lib/settings";
import { fonts } from "../../../../lib/theme";
import type { Chapter } from "../../../../lib/types";
import { useReduceMotion } from "../../../../lib/use-reduce-motion";
import {
  FORMAT_IDLE_MS,
  FORMAT_BAR_HEIGHT,
  formatBarPlacement,
  hideFormatBarWhileTyping,
  overlayFormatChrome,
  showPressMenu,
} from "../../../../lib/format-chrome";

function blockStyleFor(
  settings: { editorFont: "serif" | "sans"; editorFontSize: number },
  ink: string
): EditorStyle {
  return {
    fontFamily: settings.editorFont === "sans" ? fonts.sans : fonts.serif,
    fontSize: settings.editorFontSize,
    lineHeight: Math.round(settings.editorFontSize * 1.55),
    color: ink,
  };
}

const DICTATION_NOTICES: Record<DictationError, string> = {
  denied: "manuscript.dictateDenied",
  unavailable: "manuscript.dictateUnavailable",
  language: "manuscript.dictateLanguage",
  network: "manuscript.dictateNetwork",
};

function paragraphAtOffset(text: string, offset: number): string {
  let remaining = Math.max(0, offset);
  const parts = text.split("\n");
  for (const part of parts) {
    if (remaining <= part.length) return part;
    remaining -= part.length + 1;
  }
  return parts[parts.length - 1] ?? text;
}

export default function ManuscriptScreen() {
  return (
    <ScreenErrorBoundary>
      <ManuscriptScreenContent />
    </ScreenErrorBoundary>
  );
}

function ManuscriptScreenContent() {
  const {
    project,
    loading,
    error,
    errorDetail,
    reload,
    addChapter,
    selectedChapterId,
    setSelectedChapterId,
    readingPosition,
    recordChapterOp,
    recordReadingPosition,
    setEditingBlockIds,
  } = useProject();
  const router = useRouter();
  const renameChapter = useRenameChapter();
  const { chapterId: linkedChapterId } = useLocalSearchParams<{ chapterId?: string }>();
  // A link (a "Ciciro finished writing" notification) names the chapter to
  // open. Applied once, then cleared, so later picks are the author's own.
  useEffect(() => {
    if (typeof linkedChapterId !== "string" || !linkedChapterId) return;
    if (!project?.chapters.some((c) => c.id === linkedChapterId)) return;
    setSelectedChapterId(linkedChapterId);
    router.setParams({ chapterId: undefined });
  }, [linkedChapterId, project, router, setSelectedChapterId]);
  const { t, i18n } = useTranslation();
  const { layout, colors, settings } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const clearance = useTabBarClearance();
  const focusMode = useFocusMode();
  const headerHeight = useAppHeaderHeight();
  // The header shrinks to the slim exit-focus bar (or back) only when focus mode
  // toggles, so animating this padding is what makes the format bar glide up to
  // its focus-mode position rather than snapping there with the header.
  const screenPaddingTop = useSharedValue(headerHeight);
  const paddingFocusMode = useRef(focusMode);
  useEffect(() => {
    if (paddingFocusMode.current === focusMode) {
      screenPaddingTop.value = headerHeight;
      return;
    }
    paddingFocusMode.current = focusMode;
    screenPaddingTop.value = withTiming(headerHeight, { duration: reduceMotion ? 1 : FOCUS_TRANSITION_MS });
  }, [headerHeight, focusMode, reduceMotion, screenPaddingTop]);
  const screenStyle = useAnimatedStyle(() => ({ paddingTop: screenPaddingTop.value }));
  const chapter = project?.chapters.find((c) => c.id === selectedChapterId) ?? project?.chapters[0];
  const isScreenplay = normalizeKind(project?.kind) === "screenplay";
  // The native editor lays a script out and carries each line's element itself (Beta, iOS, off until
  // switched on in Settings): the editor's own tags are then the truth, not the blocks it loaded.
  const scriptLayoutOn = useScriptLayout();
  const scriptLanguage = useScriptLanguageSupported();
  const nativeScript = isScreenplay && scriptLayoutOn && scriptLanguage;
  const chapterRef = useRef<Chapter | null>(null);
  const previousBlocksRef = useRef<ManuscriptBlock[]>([]);
  const replaceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitChain = useRef(Promise.resolve());
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const markEditedRef = useRef<(() => void) | null>(null);
  const frozenResumeRef = useRef<{ chapterId: string; blockId: string; offset: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [localDoc, setLocalDoc] = useState<{ chapterId: string; content: string; revision: number } | null>(
    null
  );
  const [inflight, setInflight] = useState(0);
  const grammarRef = useRef<GrammarLoop | null>(null);
  const acceptGrammarRef = useRef<() => void>(() => {});
  const caretRef = useRef({ blockId: "", offset: 0, end: 0, docOffset: 0 });
  const liveTextRef = useRef<{ chapterId: string; text: string } | null>(null);
  // The element of the line under the caret, kept right the moment Return is
  // pressed or a chip tapped, not a flush later (see lib/screenplay-live.ts).
  const [caretElement, setCaretElement] = useState("action");
  const [formatTarget, setFormatTarget] = useState({ start: 0, end: 0 });
  const [targetMarks, setTargetMarks] = useState(emptyBlockMarks());
  const [targetKind, setTargetKind] = useState<FormatBlockKind>("paragraph");
  const [grammarSuggestion, setGrammarSuggestion] = useState<GrammarSuggestion | null>(null);
  const [typing, setTyping] = useState(false);
  const [pressMenuOpen, setPressMenuOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editorBounds, setEditorBounds] = useState({ width: 0, height: 0 });
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideBar = useSharedValue(0);
  const keyboardVisible = useKeyboardState((state) => state.isVisible);

  const overlay = chapter && inflight > 0 && localDoc?.chapterId === chapter.id ? localDoc : null;

  if (!chapter) {
    chapterRef.current = null;
    frozenResumeRef.current = null;
  } else if (chapterRef.current?.id !== chapter.id) {
    chapterRef.current = chapter;
    frozenResumeRef.current = null;
  } else if (!overlay) {
    chapterRef.current = chapter;
  }

  const incomingResume =
    chapter && readingPosition && readingPosition.chapterId === chapter.id
      ? {
          chapterId: chapter.id,
          blockId: readingPosition.blockId,
          offset: readingPosition.offset,
        }
      : null;
  const frozenResume = freezeResumePlace(frozenResumeRef.current, incomingResume);
  frozenResumeRef.current = frozenResume;

  const resume = useMemo(() => {
    if (!chapter || !frozenResume || frozenResume.chapterId !== chapter.id) return null;
    return {
      blockId: frozenResume.blockId,
      offset: frozenResume.offset,
      index: resumePlainTextIndex(chapter.content, frozenResume.blockId, frozenResume.offset),
    };
  }, [chapter, frozenResume]);

  const content = overlay ? overlay.content : (chapter?.content ?? "");
  const revision = overlay ? overlay.revision : (chapter?.revision ?? 0);

  const blocks = useMemo(() => {
    if (!chapter?.id) return [];
    return reuseUnchangedBlocks(previousBlocksRef.current, htmlToDoc(content, revision).doc.blocks);
  }, [chapter?.id, content, revision]);
  previousBlocksRef.current = blocks;

  const editorStyle = useMemo(() => blockStyleFor(settings, colors.ink), [settings, colors.ink]);
  const suggestions = useMemo(() => listSuggestions(content), [content]);
  const showReaderComments =
    useChapterReaderCommentCount(project?.id ?? "", chapter?.id ?? "", Boolean(project) && !focusMode) > 0;
  const showPills = suggestions.length > 0 || showReaderComments;

  const markTyping = useCallback(() => {
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), FORMAT_IDLE_MS);
  }, []);

  const commitOps = useCallback(
    (ops: ManuscriptOp[]) => {
      const current = chapterRef.current;
      if (!current || ops.length === 0) return;
      const next = applyOpsToDoc(htmlToDoc(current.content, current.revision).doc, ops);
      const nextContent = docToHtml(next);
      const local = { chapterId: current.id, content: nextContent, revision: next.revision };
      if (current.content !== nextContent || current.revision !== next.revision) {
        chapterRef.current = { ...current, content: nextContent, revision: next.revision };
      }
      setLocalDoc((prev) => (sameLocalDoc(prev, local) ? prev : local));
      const payload: SyncOp[] = ops.map((op) => ({ ...op, chapterId: current.id }));
      setInflight((count) => count + 1);
      commitChain.current = commitChain.current
        .then(() => recordChapterOp(payload))
        .catch(() => undefined)
        .finally(() => setInflight((count) => Math.max(0, count - 1)));
    },
    [recordChapterOp]
  );

  // Returns whether it actually committed something, so a caller that is
  // about to rewrite the buffer (acceptGrammar) can tell a lost flush from
  // a settled one instead of clobbering typed text that never made it out.
  const flush = useCallback(async (): Promise<boolean> => {
    if (replaceTimer.current) {
      clearTimeout(replaceTimer.current);
      replaceTimer.current = null;
    }
    const current = chapterRef.current;
    const editor = editorRef.current;
    if (!current || !editor) return false;
    let enriched: string;
    try {
      enriched = await editor.getHTML();
    } catch {
      // A native editor that unmounted between being scheduled and firing
      // (a chapter switch, or leaving the screen, inside the debounce
      // window) rejects here instead of returning - there is no buffer left
      // to read, so this flush has nothing to commit.
      return false;
    }
    commitOps(
      opsFromEnrichedHtml(current.content, enriched, current.revision, undefined, {
        screenplay: isScreenplay,
        nativeElements: nativeScript,
      })
    );
    return true;
  }, [commitOps, isScreenplay, nativeScript]);

  // What the editor is given, with the elements in it when it carries them.
  const toEditorHtml = useCallback(
    (html: string) => toEnrichedHtml(html, { elements: nativeScript }),
    [nativeScript]
  );

  const scheduleFlush = useCallback(() => {
    if (replaceTimer.current) clearTimeout(replaceTimer.current);
    replaceTimer.current = setTimeout(() => {
      void flush();
    }, REPLACE_FLUSH_MS);
  }, [flush]);

  useEffect(() => {
    const loop = new GrammarLoop(
      async ({ chapterId, blockId, text, revision, signal }) =>
        ciciro.correct.post({ chapterId, blockId, text, revision }, { signal }),
      setGrammarSuggestion,
      GRAMMAR_IDLE_MS,
      () => acceptGrammarRef.current()
    );
    grammarRef.current = loop;
    return () => {
      loop.dispose();
      grammarRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (settings.autoCorrect) return;
    grammarRef.current?.cancelAll();
    grammarRef.current?.setSuggestion(null);
  }, [settings.autoCorrect]);

  useEffect(() => {
    grammarRef.current?.cancelAll();
    grammarRef.current?.setSuggestion(null);
  }, [chapter?.id]);

  const recomputeElement = useCallback(() => {
    // The native editor reports the element under the caret itself (onChangeState).
    if (!isScreenplay || nativeScript) return;
    const current = chapterRef.current;
    if (!current) return;
    const live = liveTextRef.current;
    const tag = elementTagAtCaret(
      current.content,
      live && live.chapterId === current.id ? live.text : null,
      caretRef.current.docOffset
    );
    setCaretElement((previous) => (previous === tag ? previous : tag));
  }, [isScreenplay, nativeScript]);

  const onChangeText = useCallback(
    (text: string) => {
      setPressMenuOpen(false);
      markTyping();
      const current = chapterRef.current;
      if (!current) return;
      liveTextRef.current = { chapterId: current.id, text };
      recomputeElement();
      const at = blockAtPlainOffset(current.content, caretRef.current.docOffset);
      if (
        at &&
        settings.autoCorrect &&
        !blockHasSuggestions(current.content, at.blockId) &&
        !(isScreenplay && blockSkipsProofreading(current.content, at.blockId))
      ) {
        const live = paragraphAtOffset(text, caretRef.current.docOffset);
        grammarRef.current?.onKeystroke({
          chapterId: current.id,
          blockId: at.blockId,
          text: live,
          revision: current.revision,
          autoCorrect: true,
        });
      }
      scheduleFlush();
    },
    [isScreenplay, markTyping, recomputeElement, scheduleFlush, settings.autoCorrect]
  );

  const onContentApplied = useCallback(() => {
    liveTextRef.current = null;
  }, []);

  const liveChapterText = useCallback((current: Chapter) => {
    const live = liveTextRef.current;
    return live && live.chapterId === current.id ? live.text : blocksPlainText(current.content);
  }, []);

  // Swap a word for a synonym the way typing over it would: read what the editor shows now (it can be ahead of
  // the stored chapter), splice the word in, write the buffer back with the caret just after it, then flush like
  // a keystroke. False when the page no longer holds the word (it changed while the lookup ran).
  const replaceWord = useCallback(
    async (start: number, end: number, expected: string, replacement: string): Promise<boolean> => {
      const current = chapterRef.current;
      const editor = editorRef.current;
      if (!current || !editor) return false;
      let enriched: string;
      try {
        enriched = await editor.getHTML();
      } catch {
        return false;
      }
      const live = restampCiciroHtml(current.content, fromEnrichedHtmlAsShown(enriched), {
        nativeElements: nativeScript,
      });
      const result = replaceSelectedWord(live, start, end, expected, replacement);
      if (!result) return false;
      markEditedRef.current?.();
      editor.setValue(toEditorHtml(result.html));
      editor.setSelection(result.caret, result.caret);
      caretRef.current = { ...caretRef.current, docOffset: result.caret };
      markTyping();
      scheduleFlush();
      return true;
    },
    [markTyping, nativeScript, scheduleFlush, toEditorHtml]
  );

  // Comment, Rewrite, Describe, Expand and Fix go to the Ciciro tab, which reads the highlighted text from
  // the same store read-aloud uses (it is kept as the editor blurs) and starts the turn.
  const projectId = project?.id;
  const onSelectionAction = useCallback(
    (action: SelectionActionId) => {
      if (!projectId) return;
      // A comment is typed on the next tab, so its composer takes the keyboard over; the other actions
      // start a reply to read, so the keyboard goes with the editor.
      if (action !== "comment") editorRef.current?.blur();
      router.navigate(`/project/${projectId}/ciciro?${SELECTION_ACTION_PARAM}=${action}` as never);
    },
    [projectId, router]
  );
  const getSelectionText = useCallback(() => {
    const current = chapterRef.current;
    return current ? liveChapterText(current) : null;
  }, [liveChapterText]);
  const selectionMenu = useSelectionMenu({
    chapterId: chapter?.id,
    focused,
    bounds: editorBounds,
    getText: getSelectionText,
    replaceWord,
    onAction: onSelectionAction,
  });
  const onChangeMenuSelection = selectionMenu.onChangeSelection;

  const onCaret = useCallback(
    (start: number, end: number) => {
      const current = chapterRef.current;
      if (!current) return;
      const at = blockAtPlainOffset(current.content, start);
      caretRef.current = {
        blockId: at?.blockId ?? "",
        offset: at?.local ?? 0,
        end: at ? at.local + (end - start) : 0,
        docOffset: start,
      };
      setFormatTarget({ start, end });
      recomputeElement();
      onChangeMenuSelection(start, end);
      setReadAloudSelection({
        chapterId: current.id,
        start,
        end,
        text: start === end ? "" : liveChapterText(current).slice(start, end),
      });
      if (caretTimer.current) clearTimeout(caretTimer.current);
      caretTimer.current = setTimeout(() => {
        void recordReadingPosition({
          chapterId: current.id,
          blockId: at?.blockId ?? "",
          offset: at?.local ?? 0,
        });
      }, CARET_FLUSH_MS);
    },
    [liveChapterText, onChangeMenuSelection, recomputeElement, recordReadingPosition]
  );

  // The keyboard has no dismiss key of its own on a phone, so a tap on anything around the page
  // (the gutters, the chapter title row, the pills) puts it away.
  const dismissKeyboard = useCallback(() => {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const onFocused = useCallback(() => {
    focusedRef.current = true;
    setFocused(true);
    setEditingBlockIds(previousBlocksRef.current.map((block) => block.id));
  }, [setEditingBlockIds]);

  const onBlurred = useCallback(() => {
    focusedRef.current = false;
    setFocused(false);
    setTyping(false);
    setPressMenuOpen(false);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setEditingBlockIds([]);
    void flush();
  }, [flush, setEditingBlockIds]);

  useEffect(() => {
    if (!focused) return;
    setEditingBlockIds(blocks.map((block) => block.id));
  }, [blocks, focused, setEditingBlockIds]);

  // The chapter changed under the caret (a flush landed, a chip was applied, another
  // sequence opened): read the line again.
  useEffect(() => {
    recomputeElement();
  }, [content, chapter?.id, recomputeElement]);

  const formatBlockId = blockAtPlainOffset(content, formatTarget.start)?.blockId ?? "";
  // Dual dialogue is offered on a speech with another right above it, and on one already beside it.
  const dualOfCaret = useMemo(() => {
    if (!isScreenplay) return null;
    const speech = speechOfBlock(blocks, formatBlockId);
    return speech && (speech.pairable || speech.on) ? { on: speech.on } : null;
  }, [blocks, formatBlockId, isScreenplay]);
  const barPlacement = formatBarPlacement(settings.formatChrome);
  const barHidden = hideFormatBarWhileTyping(settings.formatChrome, typing);

  const onToggleMark = useCallback(
    (mark: BlockMark) => {
      const editor = editorRef.current;
      if (!editor) return;
      markEditedRef.current?.();
      if (mark === "bold") editor.toggleBold();
      if (mark === "italic") editor.toggleItalic();
      if (mark === "underline") editor.toggleUnderline();
      if (mark === "strike") editor.toggleStrikeThrough();
      markTyping();
      scheduleFlush();
    },
    [markTyping, scheduleFlush]
  );

  const onSetKind = useCallback(
    (kind: FormatBlockKind) => {
      const editor = editorRef.current;
      if (!editor) return;
      setPressMenuOpen(false);
      markEditedRef.current?.();
      if (kind === "heading") editor.toggleH2();
      else if (kind === "quote") editor.toggleBlockQuote();
      else if (kind === "list_item") editor.toggleUnorderedList();
      else if (targetKind === "heading") editor.toggleH2();
      else if (targetKind === "quote") editor.toggleBlockQuote();
      else if (targetKind === "list_item") editor.toggleUnorderedList();
      markTyping();
      scheduleFlush();
    },
    [markTyping, scheduleFlush, targetKind]
  );

  const onSetElement = useCallback(
    async (element: ScreenplayElement) => {
      // Lit now; the commit below only confirms it.
      setCaretElement(element);
      if (nativeScript) {
        // The editor retags the line under the caret (and its keyboard follows); the flush
        // reads the new tag back out of its HTML like any other edit.
        editorRef.current?.setScreenplayElement(element);
        markTyping();
        await flush();
        return;
      }
      await flush();
      const current = chapterRef.current;
      if (!current) return;
      const doc = htmlToDoc(current.content, current.revision).doc;
      // The caret can be on a blank line the chapter does not hold (the native view does not always
      // report one Return added): give it a block of its own, rather than retagging the line above.
      if (caretBeyondChapter(current.content, caretRef.current.docOffset)) {
        commitOps(appendEmptyBlockOps(doc, element));
        return;
      }
      // Otherwise found from the caret in what the flush just committed: the block id taken at the
      // last caret move is stale when the flush added the line since.
      const target = elementTargetId(current.content, caretRef.current.docOffset, caretRef.current.blockId) || doc.blocks[doc.blocks.length - 1]?.id;
      if (!target) return;
      commitOps(setBlockElementOps(doc, target, element));
    },
    [commitOps, flush, markTyping, nativeScript]
  );

  const onToggleDual = useCallback(async () => {
    await flush();
    const current = chapterRef.current;
    if (!current) return;
    const doc = htmlToDoc(current.content, current.revision).doc;
    const target = caretRef.current.blockId || doc.blocks[doc.blocks.length - 1]?.id;
    if (!target) return;
    commitOps(toggleDualOps(doc, target));
  }, [commitOps, flush]);

  const openPressMenu = useCallback(() => {
    setPressMenuOpen(true);
    haptics.tap();
  }, []);

  const onChangeState = useCallback(
    (state: OnChangeStateEvent) => {
      setTargetMarks(marksFromEnrichedState(state));
      setTargetKind(kindFromEnrichedState(state));
      if (nativeScript) {
        const tag = state.screenplay || "action";
        setCaretElement((previous) => (previous === tag ? previous : tag));
      }
    },
    [nativeScript]
  );

  useEffect(() => {
    hideBar.value = withTiming(barHidden ? 1 : 0, { duration: reduceMotion ? 1 : 220 });
  }, [barHidden, hideBar, reduceMotion]);

  const headerBarStyle = useAnimatedStyle(() => {
    const amount = hideBar.value;
    return {
      opacity: 1 - amount,
      transform: [{ translateY: -12 * amount }],
    };
  });

  const acceptGrammar = useCallback(async () => {
    const suggestion = grammarRef.current?.suggestion ?? grammarSuggestion;
    const loop = grammarRef.current;
    if (!suggestion || !loop) return;
    // Rewriting the buffer below replaces everything in it, so whatever was
    // typed since the last flush has to be committed first or it is lost.
    // A flush that could not commit (no editor, or one that rejected) means
    // we cannot be sure the buffer is caught up, so the rewrite is skipped
    // rather than risking it clobbering unflushed typing.
    if (!(await flush())) return;
    const current = chapterRef.current;
    if (!current || loop.suggestion !== suggestion) return;
    if (blockHasSuggestions(current.content, suggestion.blockId)) {
      loop.setSuggestion(null);
      return;
    }
    const doc = htmlToDoc(current.content, current.revision).doc;
    const live =
      loop.draftOf(suggestion.blockId) ??
      doc.blocks.find((block) => block.id === suggestion.blockId)?.text ??
      suggestion.text;
    const accepted = acceptedCorrection({ suggestion, liveText: live });
    if (!accepted) {
      loop.setSuggestion(null);
      return;
    }
    const caret = caretAfterCorrection({
      text: liveChapterText(current),
      caret: caretRef.current.docOffset,
      paragraph: live,
      span: accepted.span,
      correctedAbove: blockIsAbovePlainOffset(
        current.content,
        accepted.blockId,
        caretRef.current.docOffset
      ),
    });
    commitOps(replaceBlockOps(doc, accepted.blockId, accepted.nextText, { actor: "correction" }));
    const next = chapterRef.current;
    if (next) {
      editorRef.current?.setValue(toEditorHtml(next.content));
      editorRef.current?.setSelection(caret, caret);
    }
    loop.setSuggestion(null);
  }, [commitOps, flush, grammarSuggestion, liveChapterText, toEditorHtml]);
  acceptGrammarRef.current = acceptGrammar;

  // Accepting or rejecting is an ordinary edit: flush what was typed, apply the
  // shared rules, and commit the difference as ops like any keystroke.
  const resolveOnPhone = useCallback(
    async (action: SuggestionAction, ids?: string[]) => {
      if (!(await flush()) && editorRef.current) return;
      const current = chapterRef.current;
      if (!current) return;
      // Accepting drops the marks that say these words were Ciciro's, so the
      // tally has to be taken from the content as it stands right now.
      const acceptedWords =
        action === "accept" ? ciciroAcceptedWordCount(current.content, ids ?? null) : 0;
      const next = resolveSuggestions(current.content, action, ids ?? null);
      if (next === current.content) return;
      getAnalytics().track(action === "accept" ? "suggestion_accepted" : "suggestion_rejected", {});
      commitOps(diffHtmlToOps(current.content, next, current.revision));
      if (acceptedWords > 0) {
        void ciciro.chapters
          .recordAiInvolvement(current.id, { acceptedWords })
          .catch(() => {});
      }
      const updated = chapterRef.current;
      if (updated) editorRef.current?.setValue(toEditorHtml(updated.content));
      haptics.select();
    },
    [commitOps, flush, toEditorHtml]
  );
  const closeReview = useCallback(() => setReviewOpen(false), []);

  const ignoreGrammar = useCallback(() => {
    grammarRef.current?.setSuggestion(null);
  }, []);

  useEffect(() => {
    return () => {
      if (replaceTimer.current) clearTimeout(replaceTimer.current);
      if (caretTimer.current) clearTimeout(caretTimer.current);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setEditingBlockIds([]);
    };
  }, [setEditingBlockIds]);

  const registerEditor = useCallback(
    (ref: EnrichedTextInputInstance | null, markEdited?: () => void) => {
      editorRef.current = ref;
      markEditedRef.current = markEdited ?? null;
    },
    []
  );

  // Dictated phrases land one at a time: each one reads the editor's live HTML,
  // splices the phrase in at the caret and writes it back, so a second phrase
  // arriving mid-write waits its turn instead of overwriting the first.
  const dictationQueue = useRef<Promise<void>>(Promise.resolve());
  const [dictationNotice, setDictationNotice] = useState<DictationError | null>(null);
  // The notice shows over the page, not where VoiceOver is focused, so it is spoken too.
  useEffect(() => {
    if (dictationNotice) announce(t(DICTATION_NOTICES[dictationNotice]));
  }, [dictationNotice, t]);
  const onDictationPhrase = useCallback(
    (text: string) => {
      const lang = dictationLocale(i18n.language);
      dictationQueue.current = dictationQueue.current.then(async () => {
        const current = chapterRef.current;
        const editor = editorRef.current;
        if (!current || !editor) return;
        const live = restampCiciroHtml(current.content, fromEnrichedHtmlAsShown(await editor.getHTML()), {
          nativeElements: nativeScript,
        });
        const result = insertDictation(live, caretRef.current.docOffset, text, lang);
        if (!result) return;
        markEditedRef.current?.();
        editor.setValue(toEditorHtml(result.html));
        editor.setSelection(result.caret, result.caret);
        caretRef.current = { ...caretRef.current, docOffset: result.caret };
        markTyping();
        scheduleFlush();
      });
    },
    [i18n.language, markTyping, nativeScript, scheduleFlush, toEditorHtml]
  );
  const dictation = useDictation({
    lang: dictationLocale(i18n.language),
    onPhrase: onDictationPhrase,
    onError: setDictationNotice,
  });
  const stopDictation = dictation.stop;
  useEffect(() => {
    stopDictation();
    setDictationNotice(null);
  }, [chapter?.id, stopDictation]);
  const dictationBar = dictation.available
    ? {
        active: dictation.listening,
        onToggle: () => {
          setDictationNotice(null);
          dictation.toggle();
        },
      }
    : undefined;

  const popupSpan = grammarSuggestion
    ? selectPopupSpan(
        grammarRef.current?.draftOf(grammarSuggestion.blockId) ?? grammarSuggestion.text,
        grammarSuggestion.text,
        grammarSuggestion.spans
      )
    : null;
  const grammarOpen = Boolean(settings.autoCorrect && grammarSuggestion && popupSpan);
  const formatOverlay = overlayFormatChrome({
    chrome: settings.formatChrome,
    selected: formatTarget.start !== formatTarget.end,
    pressOpen: pressMenuOpen,
    grammarOpen,
  });
  const editorBottomInset = keyboardVisible
    ? 16
    : barPlacement === "accessory" || isScreenplay
      ? 8
      : focusMode
        ? 16
        : clearance;

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: headerHeight + 8 }]}>
        <SkeletonList count={7} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (error) {
    return <ProjectLoadError message={error} detail={errorDetail} reload={reload} />;
  }

  if (!chapter) {
    return (
      <View style={[layout.padded, { paddingTop: headerHeight + 16 }]}>
        <Text style={layout.body}>{t("manuscript.noChapters")}</Text>
        <TapPressable
          style={layout.primaryBtn}
          onPress={() => void addChapter().catch(() => haptics.warning())}
          accessibilityRole="button"
          accessibilityLabel={t("manuscript.addFirstChapter")}
        >
          <Text style={layout.primaryBtnText}>{t("manuscript.addFirstChapter")}</Text>
        </TapPressable>
      </View>
    );
  }

  // The native editor clips its padding rather than scrolling under it, so the
  // page starts below the floating header instead of running beneath it.
  return (
    <Animated.View style={[layout.screen, screenStyle]}>
      {barPlacement === "header" ? (
        <View
          testID="format-bar-slot"
          pointerEvents={barHidden ? "none" : "auto"}
          style={{ height: FORMAT_BAR_HEIGHT, overflow: "hidden" }}
        >
          <Animated.View style={headerBarStyle}>
            <FormatBar
              marks={targetMarks}
              kind={targetKind}
              placement="header"
              disabled={!focused}
              onToggleMark={onToggleMark}
              onSetKind={onSetKind}
              dictation={dictationBar}
            />
          </Animated.View>
        </View>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" automaticOffset>
        <Pressable
          testID="editor-surround"
          accessible={false}
          onPress={dismissKeyboard}
          style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}
        >
          {!focusMode ? (
            <ChapterTitleBar
              key={chapter.id}
              kind={normalizeKind(project?.kind)}
              number={(project?.chapters.findIndex((c) => c.id === chapter.id) ?? 0) + 1}
              title={chapter.title}
              onRename={(title) => renameChapter(chapter.id, title)}
            />
          ) : null}
          {showPills ? (
            <View testID="editor-pills" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <SuggestionsPill suggestions={suggestions} onOpen={() => setReviewOpen(true)} />
              {project && showReaderComments ? (
                <ReaderCommentsPill projectId={project.id} chapterId={chapter.id} />
              ) : null}
            </View>
          ) : null}
          {resume ? (
            <Text
              testID="reading-caret"
              accessibilityLabel={`${resume.blockId}:${resume.offset}`}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ position: "absolute", width: 0, height: 0, opacity: 0 }}
            >
              {`${resume.blockId}:${resume.offset}`}
            </Text>
          ) : null}
          {/* Claims the touch so a tap that lands in the page is never read as a tap around it;
              the native editor still gets it for the cursor, selection and scrolling. */}
          <View
            style={{ flex: 1 }}
            onStartShouldSetResponder={() => true}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setEditorBounds((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
            }}
          >
            <ChapterEditor
              chapterId={chapter.id}
              html={content}
              editorStyle={editorStyle}
              placeholder={isScreenplay ? t("screenplay.placeholder") : ""}
              resumeOffset={resume?.index ?? null}
              bottomInset={editorBottomInset}
              typewriter={settings.typewriterMode}
              scriptLayout={nativeScript}
              onFocused={onFocused}
              onBlurred={onBlurred}
              onChangeText={onChangeText}
              onContentApplied={onContentApplied}
              onChangeState={onChangeState}
              onChangeSelection={onCaret}
              onSelectionFrame={selectionMenu.onSelectionFrame}
              onLongPress={showPressMenu(settings.formatChrome) ? openPressMenu : undefined}
              onSetKind={showPressMenu(settings.formatChrome) ? onSetKind : undefined}
              registerEditor={registerEditor}
            />
            {selectionMenu.anchored}
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                top: 8,
                left: 0,
                right: 0,
                zIndex: 2,
                alignItems: "center",
                gap: 8,
              }}
            >
              {grammarOpen && popupSpan && grammarSuggestion ? (
                <View style={{ alignSelf: "stretch" }}>
                  <GrammarPopup
                    original={popupSpan.original}
                    replacement={popupSpan.replacement}
                    shownAt={grammarSuggestion.shownAt}
                    reduceMotion={reduceMotion}
                    onAccept={acceptGrammar}
                    onIgnore={ignoreGrammar}
                  />
                </View>
              ) : null}
              {dictation.listening || dictationNotice ? (
                <Text
                  testID="dictation-status"
                  accessibilityLiveRegion="polite"
                  numberOfLines={2}
                  style={{
                    fontFamily: fonts.sans,
                    fontSize: 13,
                    color: dictationNotice ? colors.danger : colors.inkSoft,
                    backgroundColor: colors.bg,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  {dictationNotice
                    ? t(DICTATION_NOTICES[dictationNotice])
                    : dictation.interim || t("manuscript.dictateListening")}
                </Text>
              ) : null}
              {formatOverlay.press ? (
                <FormatPressMenu kind={targetKind} onSetKind={onSetKind} />
              ) : null}
              {formatOverlay.bubble ? (
                <FormatBubble marks={targetMarks} onToggleMark={onToggleMark} />
              ) : null}
              {selectionMenu.inline}
            </View>
          </View>
        </Pressable>
        {isScreenplay ? (
          // The element controls ride just above the keyboard, where the thumb is.
          <View style={{ marginBottom: keyboardVisible || barPlacement === "accessory" ? 0 : clearance }}>
            <ScreenplayBar
              element={knownElement(caretElement)}
              dual={dualOfCaret}
              disabled={!focused}
              onSetElement={(el) => void onSetElement(el)}
              onToggleDual={() => void onToggleDual()}
            />
          </View>
        ) : null}
        {barPlacement === "accessory" ? (
          <View style={{ marginBottom: keyboardVisible ? 0 : clearance }}>
            <FormatBar
              marks={targetMarks}
              kind={targetKind}
              placement="accessory"
              disabled={!focused}
              onToggleMark={onToggleMark}
              onSetKind={onSetKind}
              dictation={dictationBar}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <SuggestionsSheet
        visible={reviewOpen}
        suggestions={suggestions}
        onClose={closeReview}
        onResolve={(action, ids) => void resolveOnPhone(action, ids)}
      />
    </Animated.View>
  );
}
