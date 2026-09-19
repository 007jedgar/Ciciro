import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeStateEvent,
} from "react-native-enriched-html";
import type { FormatBlockKind } from "./FormatBar";
import type { BlockMarks } from "../lib/block-editor";
import { toEnrichedHtml } from "../lib/enriched-html";

export type EditorStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  color: string;
};

export function marksFromEnrichedState(state: OnChangeStateEvent): BlockMarks {
  return {
    bold: state.bold.isActive,
    italic: state.italic.isActive,
    underline: state.underline.isActive,
    strike: state.strikeThrough.isActive,
  };
}

export function kindFromEnrichedState(state: OnChangeStateEvent): FormatBlockKind {
  if (state.h1.isActive || state.h2.isActive || state.h3.isActive) return "heading";
  if (state.blockQuote.isActive) return "quote";
  if (state.unorderedList.isActive || state.orderedList.isActive) return "list_item";
  return "paragraph";
}

export function ChapterEditor({
  chapterId,
  html,
  editorStyle,
  placeholder,
  focused,
  resumeOffset,
  onFocused,
  onBlurred,
  onChangeText,
  onChangeState,
  onChangeSelection,
  onSetKind,
  registerEditor,
  testID = "chapter-editor",
}: {
  chapterId: string;
  html: string;
  editorStyle: EditorStyle;
  placeholder?: string;
  focused: boolean;
  resumeOffset: number | null;
  onFocused: () => void;
  onBlurred: () => void;
  onChangeText: (text: string) => void;
  onChangeState: (state: OnChangeStateEvent) => void;
  onChangeSelection: (start: number, end: number) => void;
  onSetKind?: (kind: FormatBlockKind) => void;
  registerEditor: (ref: EnrichedTextInputInstance | null) => void;
  testID?: string;
}) {
  const inputRef = useRef<EnrichedTextInputInstance | null>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const didResume = useRef<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    registerEditor(inputRef.current);
    return () => registerEditor(null);
  }, [registerEditor]);

  useEffect(() => {
    if (focusedRef.current) return;
    inputRef.current?.setValue(toEnrichedHtml(html));
  }, [html]);

  useEffect(() => {
    if (resumeOffset == null) return;
    if (didResume.current === chapterId) return;
    didResume.current = chapterId;
    const handle = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelection(resumeOffset, resumeOffset);
    });
    return () => cancelAnimationFrame(handle);
  }, [chapterId, resumeOffset]);

  return (
    <EnrichedTextInput
      key={chapterId}
      ref={inputRef}
      testID={testID}
      defaultValue={toEnrichedHtml(html)}
      placeholder={placeholder}
      cursorColor={editorStyle.color}
      selectionColor="rgba(90, 140, 180, 0.35)"
      scrollEnabled={false}
      submitBehavior="newline"
      linkRegex={null}
      autoCapitalize="sentences"
      contextMenuItems={
        onSetKind
          ? [
              { text: t("manuscript.formatHeading"), onPress: () => onSetKind("heading") },
              { text: t("manuscript.formatQuote"), onPress: () => onSetKind("quote") },
              { text: t("manuscript.formatList"), onPress: () => onSetKind("list_item") },
              { text: t("manuscript.formatParagraph"), onPress: () => onSetKind("paragraph") },
            ]
          : undefined
      }
      htmlStyle={{
        h2: { fontSize: editorStyle.fontSize + 6, bold: true },
        blockquote: {
          color: editorStyle.color,
          borderColor: editorStyle.color,
          borderWidth: 2,
          gapWidth: 12,
        },
        ul: { marginLeft: 18, gapWidth: 6, bulletColor: editorStyle.color },
      }}
      style={{
        minHeight: editorStyle.lineHeight * 8,
        color: editorStyle.color,
        fontFamily: editorStyle.fontFamily,
        fontSize: editorStyle.fontSize,
        lineHeight: editorStyle.lineHeight,
      }}
      onFocus={() => onFocused()}
      onBlur={() => onBlurred()}
      onChangeText={(e) => onChangeText(e.nativeEvent.value)}
      onChangeState={(e) => onChangeState(e.nativeEvent)}
      onChangeSelection={(e) => onChangeSelection(e.nativeEvent.start, e.nativeEvent.end)}
    />
  );
}
