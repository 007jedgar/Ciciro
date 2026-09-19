import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { GrammarPopup } from "./GrammarPopup";
import {
  estimateSpanAnchor,
  placeCallout,
  spanAnchorFromLines,
  type TextLineMetrics,
} from "../lib/grammar";
import type { ManuscriptBlock } from "../lib/manuscript";
import { splitAtOffset, takeReturnSplit } from "../lib/block-editor";
import {
  isBackspaceAtStart,
  isGuardDeleted,
  stripCaretGuard,
  toLogicalOffset,
  toNativeOffset,
  withCaretGuard,
} from "../lib/editor-session";

export type EditorStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  color: string;
};

export type GrammarCallout = {
  start: number;
  end: number;
  original: string;
  replacement: string;
  shownAt: number;
  reduceMotion: boolean;
  onAccept: () => void;
  onIgnore: () => void;
};

export type PendingFocus = {
  id: string;
  offset: number;
  /** When set, replace the live field (grammar accept) instead of only moving the caret. */
  text?: string;
};

export type BlockInputProps = {
  block: ManuscriptBlock;
  editorStyle: EditorStyle;
  autoCorrect: boolean;
  focused: boolean;
  resumeOffset: number | null;
  pendingFocus: PendingFocus | null;
  popup: GrammarCallout | null;
  draftsRef: MutableRefObject<Map<string, string>>;
  onFocused: (id: string) => void;
  onBlurred: (id: string, text: string) => void;
  onDraft: (id: string, text: string) => void;
  onSplit: (id: string, left: string, right: string) => void;
  onMerge: (id: string, text: string) => void;
  onCaret: (id: string, offset: number) => void;
  onComposing: (id: string, composing: boolean) => void;
  onCaretPlaced: (id: string) => void;
  registerInput: (id: string, ref: TextInput | null) => void;
};

function initialText(block: ManuscriptBlock, drafts: Map<string, string>): string {
  return drafts.get(block.id) ?? block.text;
}

export const BlockInput = memo(function BlockInput({
  block,
  editorStyle,
  autoCorrect,
  focused,
  resumeOffset,
  pendingFocus,
  popup,
  draftsRef,
  onFocused,
  onBlurred,
  onDraft,
  onSplit,
  onMerge,
  onCaret,
  onComposing,
  onCaretPlaced,
  registerInput,
}: BlockInputProps) {
  const [text, setText] = useState(() => initialText(block, draftsRef.current));
  const [caret, setCaret] = useState<{ start: number; end: number } | null>(null);
  const selectionRef = useRef({
    start: toNativeOffset(resumeOffset ?? 0),
    end: toNativeOffset(resumeOffset ?? 0),
  });
  const restored = useRef(resumeOffset == null);
  const inputRef = useRef<TextInput | null>(null);
  const nativeFocused = useRef(false);
  const [blockWidth, setBlockWidth] = useState(0);
  const [lines, setLines] = useState<TextLineMetrics[]>([]);
  const [popupSize, setPopupSize] = useState({ width: 240, height: 88 });
  const splitting = useRef(false);
  const merging = useRef(false);
  const emittedSplit = useRef<{ left: string; right: string } | null>(null);
  const frames = useRef<number[]>([]);

  function later(fn: () => void) {
    const id = requestAnimationFrame(() => {
      frames.current = frames.current.filter((frame) => frame !== id);
      fn();
    });
    frames.current.push(id);
  }

  useEffect(() => {
    return () => {
      for (const id of frames.current) cancelAnimationFrame(id);
      frames.current = [];
    };
  }, []);

  useEffect(() => {
    setText(initialText(block, draftsRef.current));
  }, [block.id, draftsRef]);

  useEffect(() => {
    if (focused) return;
    if (draftsRef.current.has(block.id)) return;
    setText(block.text);
  }, [block.id, block.text, draftsRef, focused]);

  function placePending(target: PendingFocus) {
    if (target.text != null) {
      draftsRef.current.set(block.id, target.text);
      setText(target.text);
    }
    const offset = toNativeOffset(target.offset);
    selectionRef.current = { start: offset, end: offset };
    setCaret({ start: offset, end: offset });
  }

  useEffect(() => {
    if (pendingFocus?.id !== block.id) return;
    placePending(pendingFocus);
    if (nativeFocused.current) {
      onCaretPlaced(block.id);
      later(() => setCaret(null));
      return;
    }
    inputRef.current?.focus();
  }, [pendingFocus, block.id, onCaretPlaced]);

  const style = useMemo(() => {
    if (block.kind === "heading") {
      return { ...editorStyle, fontSize: editorStyle.fontSize + 6, fontWeight: "600" as const };
    }
    if (block.kind === "quote") {
      return { ...editorStyle, fontStyle: "italic" as const, paddingLeft: 12 };
    }
    return editorStyle;
  }, [block.kind, editorStyle]);

  const align = block.kind === "scene_break" ? ("center" as const) : ("left" as const);
  const displayed = withCaretGuard(text);

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

  function commitText(next: string) {
    draftsRef.current.set(block.id, next);
    setText(next);
    onDraft(block.id, next);
  }

  function splitParagraph(left: string, right: string) {
    const same =
      emittedSplit.current &&
      emittedSplit.current.left === left &&
      emittedSplit.current.right === right;
    if (same) {
      draftsRef.current.set(block.id, left);
      setText(left);
      return;
    }
    if (splitting.current) return;
    draftsRef.current.set(block.id, left);
    setText(left);
    emittedSplit.current = { left, right };
    splitting.current = true;
    onComposing(block.id, false);
    onSplit(block.id, left, right);
    later(() => {
      splitting.current = false;
    });
  }

  function mergeNow() {
    if (merging.current || splitting.current) return;
    merging.current = true;
    onComposing(block.id, false);
    onMerge(block.id, text);
    later(() => {
      merging.current = false;
    });
  }

  return (
    <View
      testID={popup ? `grammar-anchor-${block.id}` : undefined}
      onLayout={(e) => {
        const width = e.nativeEvent.layout.width;
        setBlockWidth((current) => (current === width ? current : width));
      }}
      style={{
        marginBottom: 12,
        overflow: "visible",
        zIndex: popup ? 4 : 0,
        alignSelf: "stretch",
        justifyContent: "flex-start",
      }}
    >
      <TextInput
        ref={(node) => {
          inputRef.current = node;
          registerInput(block.id, node);
        }}
        autoFocus={pendingFocus?.id === block.id}
        nativeID={block.id}
        testID={resumeOffset != null ? "reading-caret-block" : `block-${block.id}`}
        multiline
        scrollEnabled={false}
        blurOnSubmit={false}
        returnKeyType="default"
        selectTextOnFocus={false}
        textAlign={align}
        textAlignVertical="top"
        autoCorrect={autoCorrect}
        spellCheck={autoCorrect}
        value={displayed}
        {...(caret ? { selection: caret } : {})}
        {...({
          submitBehavior: "newline",
          onTextInput: (e: {
            nativeEvent?: {
              text?: string;
              previousText?: string;
              range?: { start: number; end: number };
              isComposing?: boolean;
            };
          }) => {
            const native = e.nativeEvent ?? {};
            onComposing(block.id, Boolean(native.isComposing));
            if (
              isBackspaceAtStart(native, toLogicalOffset(selectionRef.current.start), toLogicalOffset(selectionRef.current.end))
            ) {
              mergeNow();
              return;
            }
            const range = native.range;
            const inserted = native.text ?? "";
            if (range) {
              const caret = range.start + inserted.length;
              selectionRef.current = { start: caret, end: caret };
            }
            if (native.isComposing || inserted !== "\n" || !range) return;
            const at = splitAtOffset(text, toLogicalOffset(range.start));
            splitParagraph(at.left, at.right);
          },
        } as Record<string, unknown>)}
        onChangeText={(next) => {
          if (isGuardDeleted(next, displayed)) {
            mergeNow();
            return;
          }
          const logical = stripCaretGuard(next);
          const split = takeReturnSplit(logical);
          if (split) {
            splitParagraph(split.left, split.right);
            return;
          }
          emittedSplit.current = null;
          if (splitting.current) return;
          commitText(logical);
        }}
        onSubmitEditing={() => {
          const snapshot = text;
          const start = toLogicalOffset(selectionRef.current.start);
          later(() => {
            if (emittedSplit.current) return;
            const at = splitAtOffset(snapshot, start);
            splitParagraph(at.left, at.right);
          });
        }}
        onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
          selectionRef.current = e.nativeEvent.selection;
          onCaret(block.id, toLogicalOffset(e.nativeEvent.selection.start));
        }}
        onKeyPress={(e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
          // Enter used to split from selectionRef here. iOS often leaves that
          // caret at 0, so Return emptied the paragraph and left a blank line
          // in the one above. The newline in onTextInput / onChangeText is
          // the real split point.
          if (e.nativeEvent.key !== "Backspace") return;
          if (toLogicalOffset(selectionRef.current.start) === 0 && toLogicalOffset(selectionRef.current.end) === 0) {
            mergeNow();
          }
        }}
        onFocus={() => {
          nativeFocused.current = true;
          onFocused(block.id);
          if (pendingFocus?.id === block.id) {
            placePending(pendingFocus);
            onCaretPlaced(block.id);
            later(() => setCaret(null));
            return;
          }
          if (!restored.current && resumeOffset != null) {
            restored.current = true;
            const offset = toNativeOffset(Math.min(resumeOffset, text.length));
            selectionRef.current = { start: offset, end: offset };
            setCaret({ start: offset, end: offset });
            later(() => setCaret(null));
          }
        }}
        onBlur={() => {
          nativeFocused.current = false;
          onBlurred(block.id, draftsRef.current.get(block.id) ?? text);
        }}
        style={[
          style,
          {
            padding: 0,
            margin: 0,
            minHeight: style.lineHeight,
            textAlign: align,
            textAlignVertical: "top" as const,
            includeFontPadding: false,
          },
        ]}
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
