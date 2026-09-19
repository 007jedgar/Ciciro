import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from "react-native";
import * as Haptics from "expo-haptics";
import { GrammarPopup } from "./GrammarPopup";
import { FormatBubble } from "./FormatBubble";
import { FormatPressMenu } from "./FormatPressMenu";
import type { FormatBlockKind } from "./FormatBar";
import {
  estimateSpanAnchor,
  placeCallout,
  spanAnchorFromLines,
  type TextLineMetrics,
} from "../lib/grammar";
import type { BlockKind, ManuscriptBlock } from "../lib/manuscript";
import { splitAtOffset, takeReturnSplit, type BlockMark, type BlockMarks } from "../lib/block-editor";
import { applyPlainEdit, innerHtmlOf, italicAtOffset, parseInlineHtml, spansThroughOffset, type InlineSpan } from "../lib/inline-html";
import {
  CARET_GUARD,
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

export type FormatCallout = {
  start: number;
  end: number;
  marks: BlockMarks;
  onToggleMark: (mark: BlockMark) => void;
};

export type BlockInputProps = {
  block: ManuscriptBlock;
  editorStyle: EditorStyle;
  autoCorrect: boolean;
  focused: boolean;
  resumeOffset: number | null;
  pendingFocus: PendingFocus | null;
  popup: GrammarCallout | null;
  formatBubble?: FormatCallout | null;
  pressMenu?: { kind: FormatBlockKind; onSetKind: (kind: FormatBlockKind) => void } | null;
  onPressFormat?: () => void;
  draftsRef: MutableRefObject<Map<string, string>>;
  onFocused: (id: string) => void;
  onBlurred: (id: string, text: string) => void;
  onDraft: (id: string, text: string) => void;
  onSplit: (id: string, left: string, right: string) => void;
  onMerge: (id: string, text: string) => void;
  onCaret: (id: string, start: number, end: number) => void;
  onComposing: (id: string, composing: boolean) => void;
  onCaretPlaced: (id: string) => void;
  registerInput: (id: string, ref: TextInput | null) => void;
};

function initialText(block: ManuscriptBlock, drafts: Map<string, string>): string {
  return drafts.get(block.id) ?? block.text;
}

function decorationLine(span: InlineSpan): "none" | "underline" | "line-through" | "underline line-through" {
  if (span.underline && span.strike) return "underline line-through";
  if (span.strike) return "line-through";
  if (span.underline) return "underline";
  return "none";
}

function spanStyle(
  span: InlineSpan,
  kind: BlockKind,
  base: { fontFamily: string; fontSize: number; lineHeight: number }
) {
  return {
    fontFamily: base.fontFamily,
    fontSize: base.fontSize,
    lineHeight: base.lineHeight,
    fontWeight: (span.bold || kind === "heading" ? "600" : "400") as "600" | "400",
    fontStyle: (span.italic || kind === "quote" ? "italic" : "normal") as "italic" | "normal",
    textDecorationLine: decorationLine(span),
  };
}

export const CARET_WIDTH = 2;
/** Hairline after the last glyph so the bar kisses the letter instead of covering it. */
export const CARET_GAP = 1;
/** Georgia’s italic lean; the bar shears around its baseline so the top follows the stems. */
export const CARET_ITALIC_DEG = 14;

export function caretPaintStyle(opts: {
  x: number;
  y: number;
  height: number;
  paddingLeft: number;
  italic: boolean;
  color: string;
}) {
  const shear = opts.italic
    ? Math.tan((CARET_ITALIC_DEG * Math.PI) / 180) * opts.height
    : 0;
  return {
    position: "absolute" as const,
    left: opts.x + CARET_GAP + opts.paddingLeft + shear / 2,
    top: opts.y,
    width: CARET_WIDTH,
    height: opts.height,
    backgroundColor: opts.color,
    transform: opts.italic ? [{ skewX: `-${CARET_ITALIC_DEG}deg` as const }] : undefined,
  };
}

export const BlockInput = memo(function BlockInput({
  block,
  editorStyle,
  autoCorrect,
  focused,
  resumeOffset,
  pendingFocus,
  popup,
  formatBubble = null,
  pressMenu = null,
  onPressFormat,
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
  const [logicalSel, setLogicalSel] = useState({ start: 0, end: 0 });
  const [prefixCaret, setPrefixCaret] = useState<{ x: number; y: number; height: number } | null>(null);
  const [popupSize, setPopupSize] = useState({ width: 240, height: 88 });
  const [bubbleSize, setBubbleSize] = useState({ width: 148, height: 40 });
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
    const base = {
      ...editorStyle,
      fontWeight: (block.kind === "heading" ? "600" : "400") as "600" | "400",
      fontStyle: (block.kind === "quote" ? "italic" : "normal") as "italic" | "normal",
      textDecorationLine: "none" as const,
    };
    if (block.kind === "heading") {
      return { ...base, fontSize: editorStyle.fontSize + 6 };
    }
    if (block.kind === "quote") {
      return { ...base, paddingLeft: 12 };
    }
    if (block.kind === "list_item") {
      return { ...base, paddingLeft: 18 };
    }
    return base;
  }, [block.kind, editorStyle]);

  const spans = useMemo(
    () => parseInlineHtml(applyPlainEdit(innerHtmlOf(block.html), text)),
    [block.html, text]
  );
  const prefixSpans = useMemo(
    () => spansThroughOffset(spans, logicalSel.start),
    [spans, logicalSel.start]
  );
  const caretItalic = block.kind === "quote" || italicAtOffset(spans, logicalSel.start);

  const align = block.kind === "scene_break" ? ("center" as const) : ("left" as const);
  const displayed = withCaretGuard(text);
  const paintedCaret =
    focused && logicalSel.start === logicalSel.end
      ? (prefixCaret ?? { x: 0, y: 0, height: style.lineHeight })
      : null;

  const measureLayout = Boolean(popup || formatBubble);
  const grammarAnchor = popup
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
    popup && grammarAnchor
      ? placeCallout({
          anchor: grammarAnchor,
          popup: popupSize,
          blockWidth: blockWidth || 320,
        })
      : null;
  const bubbleAnchor = formatBubble
    ? spanAnchorFromLines(lines, formatBubble.start, formatBubble.end) ??
      estimateSpanAnchor({
        text,
        start: formatBubble.start,
        end: formatBubble.end,
        width: blockWidth || 320,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      })
    : null;
  const bubblePlaced =
    formatBubble && bubbleAnchor
      ? placeCallout({
          anchor: bubbleAnchor,
          popup: bubbleSize,
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
    <Pressable
      testID={popup ? `grammar-anchor-${block.id}` : `block-${block.id}-wrap`}
      delayLongPress={420}
      onLongPress={
        onPressFormat
          ? () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onPressFormat();
            }
          : undefined
      }
      onLayout={(e) => {
        const width = e.nativeEvent.layout.width;
        setBlockWidth((current) => (current === width ? current : width));
      }}
      style={{
        marginBottom: 12,
        overflow: "visible",
        zIndex: popup || pressMenu || formatBubble ? 4 : 0,
        alignSelf: "stretch",
        justifyContent: "flex-start",
      }}
    >
      {/*
        The painted prose is what sizes the paragraph. The native field below is
        transparent and absolute, so its content height — which iOS reports a
        frame or two late, and which still holds the Return newline while the
        controlled value is being reconciled — can no longer shove the page.
      */}
      <Text
        testID={`block-${block.id}-marks`}
        pointerEvents="none"
        style={[
          style,
          {
            padding: 0,
            margin: 0,
            minHeight: style.lineHeight,
            textAlign: align,
            textAlignVertical: "top" as const,
            includeFontPadding: false,
            color: editorStyle.color,
          },
        ]}
      >
        {spans.map((span, index) => (
          <Text key={index} style={spanStyle(span, block.kind, style)}>
            {span.text}
          </Text>
        ))}
      </Text>
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
          const start = toLogicalOffset(e.nativeEvent.selection.start);
          const end = toLogicalOffset(e.nativeEvent.selection.end);
          setLogicalSel((current) =>
            current.start === start && current.end === end ? current : { start, end }
          );
          onCaret(block.id, start, end);
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
          onCaret(
            block.id,
            toLogicalOffset(selectionRef.current.start),
            toLogicalOffset(selectionRef.current.end)
          );
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
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            padding: 0,
            margin: 0,
            minHeight: style.lineHeight,
            textAlign: align,
            textAlignVertical: "top" as const,
            includeFontPadding: false,
            color: "transparent",
            backgroundColor: "transparent",
          },
        ]}
        cursorColor="transparent"
        selectionColor="rgba(90, 140, 180, 0.35)"
        caretHidden
      />
      {paintedCaret ? (
        <>
          <Text
            testID={`block-${block.id}-caret-probe`}
            pointerEvents="none"
            style={[
              style,
              {
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                padding: 0,
                margin: 0,
                minHeight: style.lineHeight,
                textAlign: align,
                textAlignVertical: "top" as const,
                includeFontPadding: false,
                color: "transparent",
              },
            ]}
            onTextLayout={(e) => {
              const last = e.nativeEvent.lines[e.nativeEvent.lines.length - 1];
              if (!last) {
                setPrefixCaret({ x: 0, y: 0, height: style.lineHeight });
                return;
              }
              setPrefixCaret({
                x: last.x + last.width,
                y: last.y,
                height: last.height || style.lineHeight,
              });
            }}
          >
            {prefixSpans.length === 0
              ? "\u200B"
              : prefixSpans.map((span, index) => (
                  <Text key={index} style={spanStyle(span, block.kind, style)}>
                    {span.text}
                  </Text>
                ))}
          </Text>
          <View
            testID={`block-${block.id}-caret`}
            pointerEvents="none"
            style={caretPaintStyle({
              x: paintedCaret.x,
              y: paintedCaret.y,
              height: paintedCaret.height,
              paddingLeft: "paddingLeft" in style ? style.paddingLeft : 0,
              italic: caretItalic,
              color: editorStyle.color,
            })}
          />
        </>
      ) : null}
      {measureLayout ? (
        <Text
          pointerEvents="none"
          style={[style, { position: "absolute", opacity: 0, left: 0, width: blockWidth || "100%" }]}
          onTextLayout={(e) => setLines(e.nativeEvent.lines)}
        >
          {text}
        </Text>
      ) : null}
      {bubblePlaced && formatBubble && !popup ? (
        <View
          pointerEvents="box-none"
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (!width || !height) return;
            setBubbleSize((current) =>
              current.width === width && current.height === height ? current : { width, height }
            );
          }}
          style={{
            position: "absolute",
            top: bubblePlaced.top,
            left: bubblePlaced.left,
            zIndex: 6,
          }}
        >
          <FormatBubble marks={formatBubble.marks} onToggleMark={formatBubble.onToggleMark} />
        </View>
      ) : null}
      {pressMenu && !popup ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: -44,
            left: 0,
            zIndex: 6,
          }}
        >
          <FormatPressMenu kind={pressMenu.kind} onSetKind={pressMenu.onSetKind} />
        </View>
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
    </Pressable>
  );
});
