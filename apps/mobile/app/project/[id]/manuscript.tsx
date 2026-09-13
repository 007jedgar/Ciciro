import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import { GrammarPopup } from "../../../components/GrammarPopup";
import { useTabBarClearance } from "../../../components/ManuscriptTabBar";
import { SkeletonList } from "../../../components/Skeleton";
import { ciciro } from "../../../lib/api";
import type { SyncOp } from "../../../lib/api/types";
import {
  applyOpsToDoc,
  CARET_FLUSH_MS,
  insertFirstBlockOps,
  mergeBlockOps,
  REPLACE_FLUSH_MS,
  replaceBlockOps,
  splitBlockOps,
} from "../../../lib/block-editor";
import {
  applySpans,
  caretAfterSpans,
  estimateSpanAnchor,
  GrammarLoop,
  GRAMMAR_IDLE_MS,
  placeCallout,
  selectPopupSpan,
  spanAnchorFromLines,
  type GrammarSuggestion,
  type TextLineMetrics,
} from "../../../lib/grammar";
import {
  docToHtml,
  htmlToDoc,
  resumePlainTextIndex,
  type ManuscriptBlock,
  type ManuscriptOp,
} from "../../../lib/manuscript";
import { useProject } from "../../../lib/project";
import { useAppTheme } from "../../../lib/settings";
import { fonts } from "../../../lib/theme";
import type { Chapter } from "../../../lib/types";
import { useReduceMotion } from "../../../lib/use-reduce-motion";

type EditorStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  color: string;
};

type GrammarCallout = {
  start: number;
  end: number;
  original: string;
  replacement: string;
  shownAt: number;
  reduceMotion: boolean;
  onAccept: () => void;
  onIgnore: () => void;
};

type BlockInputProps = {
  block: ManuscriptBlock;
  editorStyle: EditorStyle;
  autoCorrect: boolean;
  focused: boolean;
  resumeOffset: number | null;
  pendingFocus: { id: string; offset: number } | null;
  popup: GrammarCallout | null;
  onFocused: (id: string) => void;
  onBlurred: (id: string, text: string) => void;
  onDraft: (id: string, text: string) => void;
  onSplit: (id: string, left: string, right: string) => void;
  onMerge: (id: string, text: string) => void;
  onCaret: (id: string, offset: number) => void;
  onComposing: (id: string, composing: boolean) => void;
  registerInput: (id: string, ref: TextInput | null) => void;
};

const BlockInput = memo(function BlockInput({
  block,
  editorStyle,
  autoCorrect,
  focused,
  resumeOffset,
  pendingFocus,
  popup,
  onFocused,
  onBlurred,
  onDraft,
  onSplit,
  onMerge,
  onCaret,
  onComposing,
  registerInput,
}: BlockInputProps) {
  const [text, setText] = useState(block.text);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(
    resumeOffset != null ? { start: resumeOffset, end: resumeOffset } : undefined
  );
  const selectionRef = useRef({ start: resumeOffset ?? 0, end: resumeOffset ?? 0 });
  const restored = useRef(resumeOffset == null);
  const [blockWidth, setBlockWidth] = useState(0);
  const [lines, setLines] = useState<TextLineMetrics[]>([]);
  const [popupSize, setPopupSize] = useState({ width: 240, height: 88 });

  useEffect(() => {
    setText(block.text);
  }, [block.id]);

  useEffect(() => {
    if (!focused) setText(block.text);
  }, [block.text, focused]);

  useEffect(() => {
    if (pendingFocus?.id !== block.id) return;
    setText(block.text);
    const offset = pendingFocus.offset;
    selectionRef.current = { start: offset, end: offset };
    setSelection({ start: offset, end: offset });
    requestAnimationFrame(() => setSelection(undefined));
  }, [pendingFocus, block.id, block.text]);

  const style = useMemo(() => {
    if (block.kind === "heading") {
      return { ...editorStyle, fontSize: editorStyle.fontSize + 6, fontWeight: "600" as const };
    }
    if (block.kind === "quote") {
      return { ...editorStyle, fontStyle: "italic" as const, paddingLeft: 12 };
    }
    if (block.kind === "scene_break") {
      return { ...editorStyle, textAlign: "center" as const };
    }
    return editorStyle;
  }, [block.kind, editorStyle]);

  const anchor = popup
    ? spanAnchorFromLines(lines, popup.start, popup.end) ??
      estimateSpanAnchor({
        text,
        start: popup.start,
        end: popup.end,
        width: blockWidth || 320,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      })
    : null;
  const placed =
    popup && anchor
      ? placeCallout({
          anchor,
          popup: popupSize,
          blockWidth: blockWidth || 320,
        })
      : null;

  return (
    <View
      testID={popup ? `grammar-anchor-${block.id}` : undefined}
      onLayout={(e) => {
        const width = e.nativeEvent.layout.width;
        setBlockWidth((current) => (current === width ? current : width));
      }}
      style={{ marginBottom: 12, overflow: "visible", zIndex: popup ? 4 : 0 }}
    >
      <TextInput
        ref={(node) => registerInput(block.id, node)}
        nativeID={block.id}
        testID={resumeOffset != null ? "reading-caret-block" : `block-${block.id}`}
        multiline
        scrollEnabled={false}
        blurOnSubmit={false}
        textAlignVertical="top"
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
        value={text}
        selection={selection}
        {...({
          onTextInput: (e: { nativeEvent?: { isComposing?: boolean } }) => {
            onComposing(block.id, Boolean(e.nativeEvent?.isComposing));
          },
        } as Record<string, unknown>)}
        onChangeText={(next) => {
          const nl = next.indexOf("\n");
          if (nl !== -1) {
            onComposing(block.id, false);
            onSplit(block.id, next.slice(0, nl), next.slice(nl + 1).replace(/\n/g, ""));
            setText(next.slice(0, nl));
            return;
          }
          setText(next);
          onDraft(block.id, next);
        }}
        onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
          selectionRef.current = e.nativeEvent.selection;
          onCaret(block.id, e.nativeEvent.selection.start);
        }}
        onKeyPress={(e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
          if (e.nativeEvent.key !== "Backspace") return;
          const { start, end } = selectionRef.current;
          if (start === 0 && end === 0) onMerge(block.id, text);
        }}
        onFocus={() => {
          onFocused(block.id);
          if (!restored.current && resumeOffset != null) {
            restored.current = true;
            const offset = Math.min(resumeOffset, text.length);
            selectionRef.current = { start: offset, end: offset };
            setSelection({ start: offset, end: offset });
            requestAnimationFrame(() => setSelection(undefined));
          }
        }}
        onBlur={() => onBlurred(block.id, text)}
        style={[style, { padding: 0 }]}
      />
      {popup ? (
        <Text
          pointerEvents="none"
          style={[style, { position: "absolute", opacity: 0, left: 0, width: blockWidth || "100%" }]}
          onTextLayout={(e) => setLines(e.nativeEvent.lines)}
        >
          {text}
        </Text>
      ) : null}
      {popup && placed ? (
        <View
          pointerEvents="box-none"
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (!width || !height) return;
            setPopupSize((current) =>
              current.width === width && current.height === height ? current : { width, height }
            );
          }}
          style={{
            position: "absolute",
            top: placed.top,
            left: placed.left,
            zIndex: 5,
            maxWidth: Math.max(160, blockWidth || 240),
          }}
        >
          <GrammarPopup
            original={popup.original}
            replacement={popup.replacement}
            shownAt={popup.shownAt}
            reduceMotion={popup.reduceMotion}
            onAccept={popup.onAccept}
            onIgnore={popup.onIgnore}
          />
        </View>
      ) : null}
    </View>
  );
});

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
  const listRef = useRef<FlashListRef<ManuscriptBlock>>(null);
  const chapterRef = useRef<Chapter | null>(null);
  const emptyIdRef = useRef<string | null>(null);
  const replaceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const caretTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitChain = useRef(Promise.resolve());
  const inputs = useRef(new Map<string, TextInput>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ id: string; offset: number } | null>(null);
  const [localDoc, setLocalDoc] = useState<{ chapterId: string; content: string; revision: number } | null>(
    null
  );
  const didScrollResume = useRef<string | null>(null);
  const grammarRef = useRef<GrammarLoop | null>(null);
  const acceptGrammarRef = useRef<() => void>(() => {});
  const caretRef = useRef({ blockId: "", offset: 0 });
  const [grammarSuggestion, setGrammarSuggestion] = useState<GrammarSuggestion | null>(null);

  if (!chapter) {
    chapterRef.current = null;
  } else if (
    !chapterRef.current ||
    chapterRef.current.id !== chapter.id ||
    chapter.revision >= chapterRef.current.revision
  ) {
    chapterRef.current = chapter;
  }

  const resume = useMemo(() => {
    if (!chapter || !readingPosition || readingPosition.chapterId !== chapter.id) {
      return null;
    }
    const index = resumePlainTextIndex(
      chapter.content,
      readingPosition.blockId,
      readingPosition.offset
    );
    return {
      blockId: readingPosition.blockId,
      offset: readingPosition.offset,
      index,
    };
  }, [chapter, readingPosition]);

  const content =
    chapter && localDoc?.chapterId === chapter.id && localDoc.revision > chapter.revision
      ? localDoc.content
      : (chapter?.content ?? "");
  const revision =
    chapter && localDoc?.chapterId === chapter.id && localDoc.revision > chapter.revision
      ? localDoc.revision
      : (chapter?.revision ?? 0);

  const blocks = useMemo(() => {
    if (!chapter) return [];
    const parsed = htmlToDoc(content, revision).doc.blocks;
    if (parsed.length > 0) {
      emptyIdRef.current = null;
      return parsed;
    }
    emptyIdRef.current ??= globalThis.crypto?.randomUUID?.() ?? "draft-block";
    const id = emptyIdRef.current;
    return [
      {
        id,
        kind: "paragraph" as const,
        html: `<p data-block-id="${id}"></p>`,
        text: "",
      },
    ];
  }, [chapter, content, revision]);

  const editorStyle = useMemo(() => blockStyleFor(settings, colors.ink), [settings, colors.ink]);

  const firstBlockIds = useCallback(
    () => ({
      createBlockId: () => emptyIdRef.current ?? (globalThis.crypto?.randomUUID?.() ?? "draft-block"),
    }),
    []
  );

  const commitOps = useCallback(
    (ops: ManuscriptOp[]) => {
      const current = chapterRef.current;
      if (!current || ops.length === 0) return;
      const next = applyOpsToDoc(htmlToDoc(current.content, current.revision).doc, ops);
      const nextContent = docToHtml(next);
      chapterRef.current = { ...current, content: nextContent, revision: next.revision };
      setLocalDoc({ chapterId: current.id, content: nextContent, revision: next.revision });
      const payload: SyncOp[] = ops.map((op) => ({ ...op, chapterId: current.id }));
      commitChain.current = commitChain.current.then(() => recordChapterOp(payload));
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
      scheduleReplace(blockId, text);
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
      const result =
        doc.blocks.length === 0
          ? (() => {
              const first = insertFirstBlockOps(doc, left, firstBlockIds());
              const after = applyOpsToDoc(doc, first.ops);
              const split = splitBlockOps(after, first.focusBlockId, left, right);
              return {
                ops: [...first.ops, ...split.ops],
                focusBlockId: split.focusBlockId,
                focusOffset: split.focusOffset,
              };
            })()
          : splitBlockOps(doc, blockId, left, right);
      grammarRef.current?.forgetBlock(blockId);
      grammarRef.current?.noteDraft(blockId, left);
      grammarRef.current?.noteDraft(result.focusBlockId, right);
      setPendingFocus({ id: result.focusBlockId, offset: result.focusOffset });
      setEditingBlockId(result.focusBlockId);
      setFocusedId(result.focusBlockId);
      commitOps(result.ops);
    },
    [commitOps, firstBlockIds, setEditingBlockId]
  );

  const onMerge = useCallback(
    (blockId: string, text: string) => {
      const pending = replaceTimers.current.get(blockId);
      if (pending) {
        clearTimeout(pending);
        replaceTimers.current.delete(blockId);
      }
      const current = chapterRef.current;
      if (!current) return;
      const result = mergeBlockOps(htmlToDoc(current.content, current.revision).doc, blockId, text);
      if (result.ops.length === 0) return;
      grammarRef.current?.forgetBlock(blockId);
      setPendingFocus({ id: result.focusBlockId, offset: result.focusOffset });
      setEditingBlockId(result.focusBlockId);
      setFocusedId(result.focusBlockId);
      commitOps(result.ops);
    },
    [commitOps, setEditingBlockId]
  );

  const onCaret = useCallback(
    (blockId: string, offset: number) => {
      caretRef.current = { blockId, offset };
      const current = chapterRef.current;
      if (!current) return;
      if (caretTimer.current) clearTimeout(caretTimer.current);
      caretTimer.current = setTimeout(() => {
        void recordReadingPosition({ chapterId: current.id, blockId, offset });
      }, CARET_FLUSH_MS);
    },
    [recordReadingPosition]
  );

  const onFocused = useCallback(
    (id: string) => {
      setFocusedId(id);
      setEditingBlockId(id);
    },
    [setEditingBlockId]
  );

  const onBlurred = useCallback(
    (id: string, text: string) => {
      grammarRef.current?.setComposing(id, false);
      grammarRef.current?.noteDraft(id, text);
      flushReplace(id, text);
      setFocusedId((current) => {
        if (current !== id) return current;
        setEditingBlockId(null);
        return null;
      });
    },
    [flushReplace, setEditingBlockId]
  );

  const acceptGrammar = useCallback(() => {
    const suggestion = grammarRef.current?.suggestion ?? grammarSuggestion;
    const current = chapterRef.current;
    const loop = grammarRef.current;
    if (!suggestion || !current || !loop) return;
    const doc = htmlToDoc(current.content, current.revision).doc;
    const live =
      loop.draftOf(suggestion.blockId) ??
      doc.blocks.find((block) => block.id === suggestion.blockId)?.text ??
      suggestion.text;
    const spans = loop.acceptableSpans(suggestion.blockId, live);
    if (spans.length === 0) {
      loop.setSuggestion(null);
      return;
    }
    const span = spans[0];
    const nextText = applySpans(live, [span]);
    const timer = replaceTimers.current.get(suggestion.blockId);
    if (timer) {
      clearTimeout(timer);
      replaceTimers.current.delete(suggestion.blockId);
    }
    loop.noteDraft(suggestion.blockId, nextText);
    commitOps(replaceBlockOps(doc, suggestion.blockId, nextText, { actor: "correction" }));
    if (focusedId === suggestion.blockId) {
      const caret =
        caretRef.current.blockId === suggestion.blockId ? caretRef.current.offset : nextText.length;
      setPendingFocus({ id: suggestion.blockId, offset: caretAfterSpans(caret, [span]) });
    }
    loop.setSuggestion(null);
  }, [commitOps, focusedId, grammarSuggestion]);
  acceptGrammarRef.current = acceptGrammar;

  const ignoreGrammar = useCallback(() => {
    grammarRef.current?.setSuggestion(null);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of replaceTimers.current.values()) clearTimeout(timer);
      if (caretTimer.current) clearTimeout(caretTimer.current);
      setEditingBlockId(null);
    };
  }, [setEditingBlockId]);

  useEffect(() => {
    if (!chapter || !resume) return;
    const key = `${chapter.id}:${resume.blockId}:${resume.offset}`;
    if (didScrollResume.current === key) return;
    const index = blocks.findIndex((block) => block.id === resume.blockId);
    if (index < 0) return;
    didScrollResume.current = key;
    const handle = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.2 });
    });
    const retry = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.2 });
    }, 120);
    return () => {
      cancelAnimationFrame(handle);
      clearTimeout(retry);
    };
  }, [blocks, chapter, resume]);

  const registerInput = useCallback((id: string, ref: TextInput | null) => {
    if (ref) inputs.current.set(id, ref);
    else inputs.current.delete(id);
  }, []);

  useEffect(() => {
    if (!pendingFocus) return;
    inputs.current.get(pendingFocus.id)?.focus();
  }, [pendingFocus, blocks]);

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

  const renderItem = useCallback(
    ({ item }: { item: ManuscriptBlock }) => (
      <BlockInput
        block={item}
        editorStyle={editorStyle}
        autoCorrect={settings.autoCorrect}
        focused={focusedId === item.id}
        resumeOffset={resume?.blockId === item.id ? resume.offset : null}
        pendingFocus={pendingFocus}
        popup={grammarCallout && grammarSuggestion?.blockId === item.id ? grammarCallout : null}
        onFocused={onFocused}
        onBlurred={onBlurred}
        onDraft={onDraft}
        onSplit={onSplit}
        onMerge={onMerge}
        onCaret={onCaret}
        onComposing={onComposing}
        registerInput={registerInput}
      />
    ),
    [
      editorStyle,
      focusedId,
      grammarCallout,
      grammarSuggestion?.blockId,
      onBlurred,
      onCaret,
      onComposing,
      onDraft,
      onFocused,
      onMerge,
      onSplit,
      pendingFocus,
      registerInput,
      resume,
      settings.autoCorrect,
    ]
  );

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
    <KeyboardAvoidingView style={layout.screen} behavior="padding">
      <FlashList
        ref={listRef}
        data={blocks}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        extraData={{
          focusedId,
          pendingFocus,
          editorStyle,
          autoCorrect: settings.autoCorrect,
          grammarBlockId: grammarSuggestion?.blockId ?? null,
          grammarShownAt: grammarSuggestion?.shownAt ?? 0,
        }}
        contentContainerStyle={{ padding: 20, paddingBottom: clearance }}
        ListHeaderComponent={
          <View>
            <Text style={layout.title}>{chapter.title}</Text>
            {resume ? (
              <Text
                testID="reading-caret"
                accessibilityLabel={`${resume.blockId}:${resume.offset}`}
                style={[layout.body, { marginBottom: 12 }]}
              >
                {`${resume.blockId}:${resume.offset}`}
              </Text>
            ) : null}
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}
