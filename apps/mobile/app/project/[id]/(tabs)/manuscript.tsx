import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { EnrichedTextInputInstance, OnChangeStateEvent } from "react-native-enriched-html";
import {
  ChapterEditor,
  kindFromEnrichedState,
  marksFromEnrichedState,
  type EditorStyle,
} from "../../../../components/ChapterEditor";
import { useAppHeaderHeight } from "../../../../components/AppHeader";
import { FormatBar, type FormatBlockKind } from "../../../../components/FormatBar";
import { FormatBubble } from "../../../../components/FormatBubble";
import { FormatPressMenu } from "../../../../components/FormatPressMenu";
import { GrammarPopup } from "../../../../components/GrammarPopup";
import { useTabBarClearance } from "../../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../../components/Skeleton";
import { SuggestionsPill, SuggestionsSheet } from "../../../../components/SuggestionsReview";
import { ciciro } from "../../../../lib/api";
import type { SyncOp } from "../../../../lib/api/types";
import {
  applyOpsToDoc,
  CARET_FLUSH_MS,
  REPLACE_FLUSH_MS,
  replaceBlockOps,
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
  opsFromEnrichedHtml,
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
  GrammarLoop,
  GRAMMAR_IDLE_MS,
  selectPopupSpan,
  type GrammarSuggestion,
} from "../../../../lib/grammar";
import { useProject } from "../../../../lib/project";
import { useFocusMode } from "../../../../lib/focus-mode";
import { blockHasSuggestions } from "../../../../lib/suggestion-review";
import {
  listSuggestions,
  resolveSuggestions,
  type SuggestionAction,
} from "../../../../lib/suggestions";
import { setReadAloudSelection } from "../../../../lib/read-aloud";
import { blocksPlainText } from "../../../../lib/read-aloud-text";
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
  const {
    project,
    loading,
    error,
    selectedChapterId,
    readingPosition,
    recordChapterOp,
    recordReadingPosition,
    setEditingBlockIds,
  } = useProject();
  const { t } = useTranslation();
  const { layout, colors, settings } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const clearance = useTabBarClearance();
  const focusMode = useFocusMode();
  const headerHeight = useAppHeaderHeight();
  const chapter = project?.chapters.find((c) => c.id === selectedChapterId) ?? project?.chapters[0];
  const chapterRef = useRef<Chapter | null>(null);
  const previousBlocksRef = useRef<ManuscriptBlock[]>([]);
  const replaceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitChain = useRef(Promise.resolve());
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
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
  const [formatTarget, setFormatTarget] = useState({ start: 0, end: 0 });
  const [targetMarks, setTargetMarks] = useState(emptyBlockMarks());
  const [targetKind, setTargetKind] = useState<FormatBlockKind>("paragraph");
  const [grammarSuggestion, setGrammarSuggestion] = useState<GrammarSuggestion | null>(null);
  const [typing, setTyping] = useState(false);
  const [pressMenuOpen, setPressMenuOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
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

  const flush = useCallback(async () => {
    if (replaceTimer.current) {
      clearTimeout(replaceTimer.current);
      replaceTimer.current = null;
    }
    const current = chapterRef.current;
    const editor = editorRef.current;
    if (!current || !editor) return;
    const enriched = await editor.getHTML();
    commitOps(opsFromEnrichedHtml(current.content, enriched, current.revision));
  }, [commitOps]);

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

  const onChangeText = useCallback(
    (text: string) => {
      setPressMenuOpen(false);
      markTyping();
      const current = chapterRef.current;
      if (!current) return;
      liveTextRef.current = { chapterId: current.id, text };
      const at = blockAtPlainOffset(current.content, caretRef.current.docOffset);
      if (at && settings.autoCorrect && !blockHasSuggestions(current.content, at.blockId)) {
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
    [markTyping, scheduleFlush, settings.autoCorrect]
  );

  const liveChapterText = useCallback((current: Chapter) => {
    const live = liveTextRef.current;
    return live && live.chapterId === current.id ? live.text : blocksPlainText(current.content);
  }, []);

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
    [liveChapterText, recordReadingPosition]
  );

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

  const barPlacement = formatBarPlacement(settings.formatChrome);
  const barHidden = hideFormatBarWhileTyping(settings.formatChrome, typing);

  const onToggleMark = useCallback(
    (mark: BlockMark) => {
      const editor = editorRef.current;
      if (!editor) return;
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

  const openPressMenu = useCallback(() => {
    setPressMenuOpen(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const onChangeState = useCallback((state: OnChangeStateEvent) => {
    setTargetMarks(marksFromEnrichedState(state));
    setTargetKind(kindFromEnrichedState(state));
  }, []);

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

  const acceptGrammar = useCallback(() => {
    const suggestion = grammarRef.current?.suggestion ?? grammarSuggestion;
    const current = chapterRef.current;
    const loop = grammarRef.current;
    if (!suggestion || !current || !loop) return;
    if (blockHasSuggestions(current.content, suggestion.blockId)) {
      loop.setSuggestion(null);
      return;
    }
    const doc = htmlToDoc(current.content, current.revision).doc;
    const live =
      loop.draftOf(suggestion.blockId) ??
      doc.blocks.find((block) => block.id === suggestion.blockId)?.text ??
      suggestion.text;
    const caret = caretRef.current.blockId === suggestion.blockId ? caretRef.current.offset : live.length;
    const accepted = acceptedCorrection({ suggestion, liveText: live, caret });
    if (!accepted) {
      loop.setSuggestion(null);
      return;
    }
    commitOps(replaceBlockOps(doc, accepted.blockId, accepted.nextText, { actor: "correction" }));
    const next = chapterRef.current;
    if (next) editorRef.current?.setValue(toEnrichedHtml(next.content));
    loop.setSuggestion(null);
  }, [commitOps, grammarSuggestion]);
  acceptGrammarRef.current = acceptGrammar;

  // Accepting or rejecting is an ordinary edit: flush what was typed, apply the
  // shared rules, and commit the difference as ops like any keystroke.
  const resolveOnPhone = useCallback(
    async (action: SuggestionAction, ids?: string[]) => {
      await flush();
      const current = chapterRef.current;
      if (!current) return;
      const next = resolveSuggestions(current.content, action, ids ?? null);
      if (next === current.content) return;
      commitOps(diffHtmlToOps(current.content, next, current.revision));
      const updated = chapterRef.current;
      if (updated) editorRef.current?.setValue(toEnrichedHtml(updated.content));
      Haptics.selectionAsync().catch(() => {});
    },
    [commitOps, flush]
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

  const registerEditor = useCallback((ref: EnrichedTextInputInstance | null) => {
    editorRef.current = ref;
  }, []);

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
    : barPlacement === "accessory"
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
    return (
      <View style={[layout.padded, { paddingTop: headerHeight + 16 }]}>
        <Text style={layout.error}>{error}</Text>
      </View>
    );
  }

  if (!chapter) {
    return (
      <View style={[layout.padded, { paddingTop: headerHeight + 16 }]}>
        <Text style={layout.body}>{t("manuscript.noChapters")}</Text>
      </View>
    );
  }

  // The native editor clips its padding rather than scrolling under it, so the
  // page starts below the floating header instead of running beneath it.
  return (
    <View style={[layout.screen, { paddingTop: headerHeight }]}>
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
            />
          </Animated.View>
        </View>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" automaticOffset>
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
          <SuggestionsPill suggestions={suggestions} onOpen={() => setReviewOpen(true)} />
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
          <View style={{ flex: 1 }}>
            <ChapterEditor
              chapterId={chapter.id}
              html={content}
              editorStyle={editorStyle}
              placeholder=""
              focused={focused}
              resumeOffset={resume?.index ?? null}
              bottomInset={editorBottomInset}
              typewriter={settings.typewriterMode}
              onFocused={onFocused}
              onBlurred={onBlurred}
              onChangeText={onChangeText}
              onChangeState={onChangeState}
              onChangeSelection={onCaret}
              onLongPress={showPressMenu(settings.formatChrome) ? openPressMenu : undefined}
              onSetKind={showPressMenu(settings.formatChrome) ? onSetKind : undefined}
              registerEditor={registerEditor}
            />
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
              {formatOverlay.press ? (
                <FormatPressMenu kind={targetKind} onSetKind={onSetKind} />
              ) : null}
              {formatOverlay.bubble ? (
                <FormatBubble marks={targetMarks} onToggleMark={onToggleMark} />
              ) : null}
            </View>
          </View>
        </View>
        {barPlacement === "accessory" ? (
          <View style={{ marginBottom: keyboardVisible ? 0 : clearance }}>
            <FormatBar
              marks={targetMarks}
              kind={targetKind}
              placement="accessory"
              disabled={!focused}
              onToggleMark={onToggleMark}
              onSetKind={onSetKind}
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
    </View>
  );
}
