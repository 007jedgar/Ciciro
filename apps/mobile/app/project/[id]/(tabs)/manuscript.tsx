import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import {
  BlockInput,
  type EditorStyle,
  type GrammarCallout,
  type PendingFocus,
} from "../../../../components/BlockInput";
import { FormatBar, type FormatBlockKind } from "../../../../components/FormatBar";
import { useTabBarClearance } from "../../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../../components/Skeleton";
import { ciciro } from "../../../../lib/api";
import type { SyncOp } from "../../../../lib/api/types";
import { chapterDrafts } from "../../../../lib/chapter-drafts";
import {
  applyOpsToDoc,
  backspaceAtStartOps,
  CARET_FLUSH_MS,
  insertFirstBlockOps,
  REPLACE_FLUSH_MS,
  replaceBlockOps,
  retagBlockOps,
  splitOrInsertBlockOps,
  toggleBlockMarkOps,
  emptyBlockMarks,
  type BlockMark,
} from "../../../../lib/block-editor";
import { applyPlainEdit, innerHtmlOf, marksCovering } from "../../../../lib/inline-html";
import {
  freezeResumePlace,
  reuseUnchangedBlocks,
  sameLocalDoc,
  takePlaceholderBlockId,
} from "../../../../lib/editor-session";
import {
  docToHtml,
  htmlToDoc,
  newBlockId,
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
import { useAppTheme } from "../../../../lib/settings";
import { fonts } from "../../../../lib/theme";
import type { Chapter } from "../../../../lib/types";
import { useReduceMotion } from "../../../../lib/use-reduce-motion";
import { FORMAT_IDLE_MS, formatBarPlacement, hideFormatBarWhileTyping, showSelectionBubble } from "../../../../lib/format-chrome";

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

export default function ManuscriptScreen() {
  const {
    project,
    loading,
    error,
    selectedChapterId,
    readingPosition,
    recordChapterOp,
    recordReadingPosition,
    setEditingBlockId,
  } = useProject();
  const { t } = useTranslation();
  const { layout, colors, settings } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const clearance = useTabBarClearance();
  const chapter = project?.chapters.find((c) => c.id === selectedChapterId) ?? project?.chapters[0];
  const chapterRef = useRef<Chapter | null>(null);
  const emptyIdRef = useRef<string | null>(null);
  // Unflushed typing lives outside this component so a remount cannot lose it.
  const draftsRef = useMemo(() => ({ current: chapterDrafts(chapter?.id ?? "") }), [chapter?.id]);
  const previousBlocksRef = useRef<ManuscriptBlock[]>([]);
  const replaceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const caretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitChain = useRef(Promise.resolve());
  const inputs = useRef(new Map<string, TextInput>());
  const frozenResumeRef = useRef<{ chapterId: string; blockId: string; offset: number } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const pendingFocusRef = useRef(pendingFocus);
  pendingFocusRef.current = pendingFocus;
  const [localDoc, setLocalDoc] = useState<{ chapterId: string; content: string; revision: number } | null>(
    null
  );
  // Commits this screen has issued whose push has not finished. While any are
  // outstanding the screen paints its own optimistic document; once the chain
  // drains it adopts whatever the replica settled on (accepted, rebased, or
  // refetched), so a rejected op can never pin stale prose on screen.
  const [inflight, setInflight] = useState(0);
  const didFocusResume = useRef<string | null>(null);
  const grammarRef = useRef<GrammarLoop | null>(null);
  const acceptGrammarRef = useRef<() => void>(() => {});
  const caretRef = useRef({ blockId: "", offset: 0, end: 0 });
  const [formatTarget, setFormatTarget] = useState({ blockId: "", start: 0, end: 0 });
  const [grammarSuggestion, setGrammarSuggestion] = useState<GrammarSuggestion | null>(null);
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideBar = useSharedValue(0);

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
    const parsed = reuseUnchangedBlocks(
      previousBlocksRef.current,
      htmlToDoc(content, revision).doc.blocks
    );
    if (parsed.length > 0) {
      emptyIdRef.current = null;
      return parsed;
    }
    emptyIdRef.current ??= newBlockId();
    const id = emptyIdRef.current;
    return reuseUnchangedBlocks(previousBlocksRef.current, [
      {
        id,
        kind: "paragraph" as const,
        html: `<p data-block-id="${id}"></p>`,
        text: "",
      },
    ]);
  }, [chapter?.id, content, revision]);
  previousBlocksRef.current = blocks;

  const editorStyle = useMemo(() => blockStyleFor(settings, colors.ink), [settings, colors.ink]);

  const firstBlockIds = useCallback(
    () => ({
      createBlockId: () => takePlaceholderBlockId(emptyIdRef),
    }),
    []
  );

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

  const flushReplace = useCallback(
    (blockId: string, text: string) => {
      const timer = replaceTimers.current.get(blockId);
      if (timer) {
        clearTimeout(timer);
        replaceTimers.current.delete(blockId);
      }
      const current = chapterRef.current;
      if (!current) return;
      const doc = htmlToDoc(current.content, current.revision).doc;
      if (doc.blocks.length === 0) {
        commitOps(insertFirstBlockOps(doc, text, firstBlockIds()).ops);
        return;
      }
      commitOps(replaceBlockOps(doc, blockId, text));
    },
    [commitOps, firstBlockIds]
  );

  const scheduleReplace = useCallback(
    (blockId: string, text: string) => {
      const existing = replaceTimers.current.get(blockId);
      if (existing) clearTimeout(existing);
      replaceTimers.current.set(
        blockId,
        setTimeout(() => flushReplace(blockId, text), REPLACE_FLUSH_MS)
      );
    },
    [flushReplace]
  );

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

  const onDraft = useCallback(
    (blockId: string, text: string) => {
      draftsRef.current.set(blockId, text);
      scheduleReplace(blockId, text);
      setTyping(true);
      setFormatTarget((current) =>
        current.blockId === blockId && current.start !== current.end
          ? { blockId, start: 0, end: 0 }
          : current
      );
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), FORMAT_IDLE_MS);
      const current = chapterRef.current;
      if (!current) return;
      grammarRef.current?.onKeystroke({
        chapterId: current.id,
        blockId,
        text,
        revision: current.revision,
        autoCorrect: settings.autoCorrect,
      });
    },
    [scheduleReplace, settings.autoCorrect]
  );

  const onComposing = useCallback(
    (blockId: string, composing: boolean) => {
      const loop = grammarRef.current;
      if (!loop) return;
      loop.setComposing(blockId, composing);
      if (composing) return;
      const current = chapterRef.current;
      const text = loop.draftOf(blockId);
      if (!current || text == null) return;
      loop.onKeystroke({
        chapterId: current.id,
        blockId,
        text,
        revision: current.revision,
        autoCorrect: settings.autoCorrect,
      });
    },
    [settings.autoCorrect]
  );

  const onSplit = useCallback(
    (blockId: string, left: string, right: string) => {
      const pending = replaceTimers.current.get(blockId);
      if (pending) {
        clearTimeout(pending);
        replaceTimers.current.delete(blockId);
      }
      const current = chapterRef.current;
      if (!current) return;
      const doc = htmlToDoc(current.content, current.revision).doc;
      const result = splitOrInsertBlockOps(doc, blockId, left, right, firstBlockIds());
      grammarRef.current?.forgetBlock(blockId);
      grammarRef.current?.noteDraft(blockId, left);
      grammarRef.current?.noteDraft(result.focusBlockId, right);
      draftsRef.current.set(blockId, left);
      draftsRef.current.set(result.focusBlockId, right);
      setPendingFocus({ id: result.focusBlockId, offset: result.focusOffset });
      setEditingBlockId(result.focusBlockId);
      setFocusedId(result.focusBlockId);
      commitOps(result.ops);
    },
    [commitOps, firstBlockIds, setEditingBlockId]
  );

  const onContinueAfterLast = useCallback(() => {
    const last = blocks[blocks.length - 1];
    if (!last) return;
    const live = draftsRef.current.get(last.id) ?? last.text;
    if (!live) {
      setPendingFocus({ id: last.id, offset: 0 });
      setEditingBlockId(last.id);
      setFocusedId(last.id);
      inputs.current.get(last.id)?.focus();
      return;
    }
    onSplit(last.id, live, "");
  }, [blocks, onSplit, setEditingBlockId]);

  const onMerge = useCallback(
    (blockId: string, text: string) => {
      const pending = replaceTimers.current.get(blockId);
      if (pending) {
        clearTimeout(pending);
        replaceTimers.current.delete(blockId);
      }
      const current = chapterRef.current;
      if (!current) return;
      const doc = htmlToDoc(current.content, current.revision).doc;
      const result = backspaceAtStartOps(doc, blockId, text);
      if (result.ops.length === 0) return;
      const next = applyOpsToDoc(doc, result.ops);
      const focused = next.blocks.find((block) => block.id === result.focusBlockId);
      for (const op of result.ops) {
        if (op.type === "delete_block") {
          draftsRef.current.delete(op.blockId);
          grammarRef.current?.forgetBlock(op.blockId);
        }
      }
      if (focused) draftsRef.current.set(focused.id, focused.text);
      grammarRef.current?.forgetBlock(blockId);
      if (focused) grammarRef.current?.noteDraft(focused.id, focused.text);
      setPendingFocus({ id: result.focusBlockId, offset: result.focusOffset });
      setEditingBlockId(result.focusBlockId);
      setFocusedId(result.focusBlockId);
      commitOps(result.ops);
    },
    [commitOps, setEditingBlockId]
  );

  const onCaret = useCallback(
    (blockId: string, start: number, end: number) => {
      caretRef.current = { blockId, offset: start, end };
      if (start !== end) {
        setFormatTarget({ blockId, start, end });
      }
      const current = chapterRef.current;
      if (!current) return;
      if (caretTimer.current) clearTimeout(caretTimer.current);
      caretTimer.current = setTimeout(() => {
        void recordReadingPosition({ chapterId: current.id, blockId, offset: start });
      }, CARET_FLUSH_MS);
    },
    [recordReadingPosition]
  );

  const onFocused = useCallback(
    (id: string) => {
      setFocusedId(id);
      setEditingBlockId(id);
      setPendingFocus((current) => (current && current.id !== id ? null : current));
    },
    [setEditingBlockId]
  );

  const onBlurred = useCallback(
    (id: string, text: string) => {
      const live = draftsRef.current.get(id) ?? text;
      grammarRef.current?.setComposing(id, false);
      grammarRef.current?.noteDraft(id, live);
      flushReplace(id, live);
      draftsRef.current.delete(id);
      setTyping(false);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setFocusedId((current) => {
        if (current !== id) return current;
        setEditingBlockId(null);
        return null;
      });
    },
    [flushReplace, setEditingBlockId]
  );

  const targetBlockId =
    focusedId ??
    (formatTarget.blockId || null) ??
    blocks[0]?.id ??
    null;
  const targetBlock = blocks.find((block) => block.id === targetBlockId) ?? null;
  const markBlock =
    (formatTarget.blockId && blocks.find((block) => block.id === formatTarget.blockId)) || targetBlock;
  const markLive = markBlock ? (draftsRef.current.get(markBlock.id) ?? markBlock.text) : "";
  const targetMarks = markBlock
    ? marksCovering(
        applyPlainEdit(innerHtmlOf(markBlock.html), markLive),
        formatTarget.start,
        formatTarget.end
      )
    : undefined;
  const targetKind: FormatBlockKind =
    targetBlock?.kind === "heading" || targetBlock?.kind === "quote" || targetBlock?.kind === "list_item"
      ? targetBlock.kind
      : "paragraph";
  const barPlacement = formatBarPlacement(settings.formatChrome);
  const barHidden = hideFormatBarWhileTyping(settings.formatChrome, typing);

  const applyFormat = useCallback(
    (ops: ReturnType<typeof retagBlockOps>) => {
      if (!targetBlockId || ops.length === 0) return;
      const pending = replaceTimers.current.get(targetBlockId);
      if (pending) {
        clearTimeout(pending);
        replaceTimers.current.delete(targetBlockId);
      }
      commitOps(ops);
    },
    [commitOps, targetBlockId]
  );

  const onToggleMark = useCallback(
    (mark: BlockMark) => {
      const current = chapterRef.current;
      const blockId =
        formatTarget.start !== formatTarget.end ? formatTarget.blockId : targetBlockId;
      if (!current || !blockId) return;
      const doc = htmlToDoc(current.content, current.revision).doc;
      const live = draftsRef.current.get(blockId);
      const range =
        formatTarget.blockId === blockId
          ? { start: formatTarget.start, end: formatTarget.end }
          : undefined;
      applyFormat(toggleBlockMarkOps(doc, blockId, mark, live, undefined, range));
    },
    [applyFormat, formatTarget.blockId, formatTarget.end, formatTarget.start, targetBlockId]
  );

  const onSetKind = useCallback(
    (kind: FormatBlockKind) => {
      const current = chapterRef.current;
      if (!current || !targetBlockId) return;
      const doc = htmlToDoc(current.content, current.revision).doc;
      const live = draftsRef.current.get(targetBlockId);
      applyFormat(retagBlockOps(doc, targetBlockId, kind, live));
    },
    [applyFormat, targetBlockId]
  );

  useEffect(() => {
    hideBar.value = withTiming(barHidden ? 1 : 0, { duration: reduceMotion ? 1 : 220 });
  }, [barHidden, hideBar, reduceMotion]);

  const headerBarStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hideBar.value * -8 }],
    marginTop: -52 * hideBar.value,
  }));

  const acceptGrammar = useCallback(() => {
    const suggestion = grammarRef.current?.suggestion ?? grammarSuggestion;
    const current = chapterRef.current;
    const loop = grammarRef.current;
    if (!suggestion || !current || !loop) return;
    const doc = htmlToDoc(current.content, current.revision).doc;
    const live =
      loop.draftOf(suggestion.blockId) ??
      draftsRef.current.get(suggestion.blockId) ??
      doc.blocks.find((block) => block.id === suggestion.blockId)?.text ??
      suggestion.text;
    const caret =
      caretRef.current.blockId === suggestion.blockId ? caretRef.current.offset : live.length;
    const accepted = acceptedCorrection({ suggestion, liveText: live, caret });
    if (!accepted) {
      loop.setSuggestion(null);
      return;
    }
    const timer = replaceTimers.current.get(accepted.blockId);
    if (timer) {
      clearTimeout(timer);
      replaceTimers.current.delete(accepted.blockId);
    }
    loop.noteDraft(accepted.blockId, accepted.nextText);
    draftsRef.current.set(accepted.blockId, accepted.nextText);
    commitOps(replaceBlockOps(doc, accepted.blockId, accepted.nextText, { actor: "correction" }));
    setPendingFocus({ id: accepted.blockId, offset: accepted.caret, text: accepted.nextText });
    loop.setSuggestion(null);
  }, [commitOps, grammarSuggestion]);
  acceptGrammarRef.current = acceptGrammar;

  const ignoreGrammar = useCallback(() => {
    grammarRef.current?.setSuggestion(null);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of replaceTimers.current.values()) clearTimeout(timer);
      if (caretTimer.current) clearTimeout(caretTimer.current);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      setEditingBlockId(null);
    };
  }, [setEditingBlockId]);

  useEffect(() => {
    if (!chapter || !resume) return;
    const key = chapter.id;
    if (didFocusResume.current === key) return;
    if (!blocks.some((block) => block.id === resume.blockId)) return;
    didFocusResume.current = key;
    const handle = requestAnimationFrame(() => {
      inputs.current.get(resume.blockId)?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [blocks, chapter, resume]);

  const registerInput = useCallback((id: string, ref: TextInput | null) => {
    if (ref) {
      inputs.current.set(id, ref);
      if (pendingFocusRef.current?.id === id) ref.focus();
    } else {
      inputs.current.delete(id);
    }
  }, []);

  const onCaretPlaced = useCallback((id: string) => {
    setPendingFocus((current) => (current?.id === id ? null : current));
  }, []);

  useEffect(() => {
    if (!pendingFocus) return;
    const id = pendingFocus.id;
    let next: number | null = null;
    let attempts = 0;
    const attempt = () => {
      inputs.current.get(id)?.focus();
      attempts += 1;
      if (attempts < 12 && pendingFocusRef.current?.id === id) {
        next = requestAnimationFrame(attempt);
      }
    };
    next = requestAnimationFrame(attempt);
    return () => {
      if (next != null) cancelAnimationFrame(next);
    };
  }, [pendingFocus]);

  const popupSpan = grammarSuggestion
    ? selectPopupSpan(
        grammarRef.current?.draftOf(grammarSuggestion.blockId) ?? grammarSuggestion.text,
        grammarSuggestion.text,
        grammarSuggestion.spans
      )
    : null;

  const grammarCallout: GrammarCallout | null =
    settings.autoCorrect && grammarSuggestion && popupSpan
      ? {
          start: popupSpan.start,
          end: popupSpan.end,
          original: popupSpan.original,
          replacement: popupSpan.replacement,
          shownAt: grammarSuggestion.shownAt,
          reduceMotion,
          onAccept: acceptGrammar,
          onIgnore: ignoreGrammar,
        }
      : null;

  if (loading && !project) {
    return (
      <View style={[layout.padded, { paddingTop: 8 }]}>
        <SkeletonList count={7} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={layout.padded}>
        <Text style={layout.error}>{error}</Text>
      </View>
    );
  }

  if (!chapter) {
    return (
      <View style={layout.padded}>
        <Text style={layout.body}>{t("manuscript.noChapters")}</Text>
      </View>
    );
  }

  return (
    <View style={layout.screen}>
      {barPlacement === "header" ? (
        <View style={{ overflow: "hidden" }}>
          <Animated.View style={headerBarStyle}>
            <FormatBar
              marks={targetMarks}
              kind={targetKind}
              placement="header"
              disabled={!targetBlockId}
              onToggleMark={onToggleMark}
              onSetKind={onSetKind}
            />
          </Animated.View>
        </View>
      ) : null}
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        bottomOffset={clearance + (barPlacement === "accessory" ? 52 : 0)}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: clearance + (barPlacement === "accessory" ? 52 : 0),
          flexGrow: 1,
          justifyContent: "flex-start",
          alignItems: "stretch",
        }}
      >
      <Text style={layout.title}>{chapter.title}</Text>
      {resume ? (
        // Test hook only: where the caret resumed. Kept out of layout and
        // out of the accessibility tree so it cannot shift the page.
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
      {blocks.map((item) => (
        <BlockInput
          key={item.id}
          block={item}
          editorStyle={editorStyle}
          autoCorrect={settings.autoCorrect}
          focused={focusedId === item.id}
          resumeOffset={resume?.blockId === item.id ? resume.offset : null}
          pendingFocus={pendingFocus?.id === item.id ? pendingFocus : null}
          popup={grammarCallout && grammarSuggestion?.blockId === item.id ? grammarCallout : null}
          formatBubble={
            showSelectionBubble(settings.formatChrome, formatTarget.start !== formatTarget.end) &&
            item.id === formatTarget.blockId &&
            !(grammarCallout && grammarSuggestion?.blockId === item.id)
              ? {
                  start: formatTarget.start,
                  end: formatTarget.end,
                  marks: targetMarks ?? emptyBlockMarks(),
                  onToggleMark,
                }
              : null
          }
          draftsRef={draftsRef}
          onFocused={onFocused}
          onBlurred={onBlurred}
          onDraft={onDraft}
          onSplit={onSplit}
          onMerge={onMerge}
          onCaret={onCaret}
          onComposing={onComposing}
          onCaretPlaced={onCaretPlaced}
          registerInput={registerInput}
        />
      ))}
      <Pressable
        testID="continue-writing"
        accessibilityRole="button"
        accessibilityLabel={t("manuscript.continueWriting")}
        onPress={onContinueAfterLast}
        style={{ minHeight: 180 }}
      />
    </KeyboardAwareScrollView>
      {barPlacement === "accessory" ? (
        <View style={{ marginBottom: clearance }}>
          <FormatBar
            marks={targetMarks}
            kind={targetKind}
            placement="accessory"
            disabled={!targetBlockId}
            onToggleMark={onToggleMark}
            onSetKind={onSetKind}
          />
        </View>
      ) : null}
    </View>
  );
}
