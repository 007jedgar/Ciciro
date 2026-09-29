import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeStateEvent,
} from "react-native-enriched-html";
import type { FormatBlockKind } from "./FormatBar";
import type { BlockMarks } from "../lib/block-editor";
import { opsFromEnrichedHtml, toEnrichedHtml } from "../lib/enriched-html";
import { FORMAT_PRESS_MS } from "../lib/format-chrome";
import { typewriterBottomInset } from "../lib/focus-mode";

export type EditorStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  color: string;
};

/**
 * Space after each paragraph in ems, so phone drafts keep the paragraph
 * separation the desktop editor has without storing blank paragraphs. The native
 * `paragraphSpacing` prop comes from `patches/react-native-enriched-html+*.patch`.
 */
export const PARAGRAPH_SPACING_EM = 0.9;

export function paragraphSpacingFor(fontSize: number): number {
  return fontSize * PARAGRAPH_SPACING_EM;
}

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
  resumeOffset,
  bottomInset = 0,
  typewriter = false,
  onFocused,
  onBlurred,
  onChangeText,
  onContentApplied,
  onChangeState,
  onChangeSelection,
  onLongPress,
  onSetKind,
  registerEditor,
  testID = "chapter-editor",
}: {
  chapterId: string;
  html: string;
  editorStyle: EditorStyle;
  placeholder?: string;
  resumeOffset: number | null;
  bottomInset?: number;
  typewriter?: boolean;
  onFocused: () => void;
  onBlurred: () => void;
  onChangeText: (text: string) => void;
  onContentApplied?: () => void;
  onChangeState: (state: OnChangeStateEvent) => void;
  onChangeSelection: (start: number, end: number) => void;
  onLongPress?: () => void;
  onSetKind?: (kind: FormatBlockKind) => void;
  registerEditor: (ref: EnrichedTextInputInstance | null, markEdited?: () => void) => void;
  testID?: string;
}) {
  const inputRef = useRef<EnrichedTextInputInstance | null>(null);
  // Whether the user has typed since the editor last resynced with `html`.
  // Native focus alone doesn't set this: the resume effect below focuses the
  // input programmatically (to restore the caret on reopen) before the user
  // has touched anything, and gating on `focused` there made a chapter opened
  // cold stick with whatever `html` it mounted with forever, since every later
  // correction to `html` (e.g. once the real content lands) was skipped by a
  // guard meant to protect in-progress typing, not a passive resume-focus.
  const dirtyRef = useRef(false);
  // The `html` the sync effect last pushed via setValue. The native editor
  // re-emits onChangeText for a programmatic setValue too (it compares its
  // text storage to what it last reported, not to "did the user type"), so
  // onChangeText alone can't tell a real edit from an echo of our own write.
  // Only a buffer that diffs against this into ops is a real edit; no ops
  // means the native layer is echoing what we just set. Plain text can't
  // decide it: a multi-paragraph quote echoes its lines newline-separated.
  const appliedHtmlRef = useRef<string | null>(null);
  const focusedRef = useRef(false);
  // Bumped by every local edit, so an async getHTML() read that a newer edit
  // overtook is recognised as stale and its result discarded.
  const editEpochRef = useRef(0);
  // The enriched HTML the sync effect last pushed, cleared by any local edit.
  // A new `html` that renders the same as it (a commit settling, or a block id
  // being stamped) has nothing to correct, so rewriting the buffer would only
  // throw away the caret.
  const appliedEnrichedRef = useRef<string | null>(null);
  const onContentAppliedRef = useRef(onContentApplied);
  onContentAppliedRef.current = onContentApplied;
  const didResume = useRef<string | null>(null);
  const pressTouch = useRef<{
    handle: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null>(null);
  const { t } = useTranslation();
  const [shellHeight, setShellHeight] = useState(0);
  const typewriterPad = typewriterBottomInset(typewriter, shellHeight - bottomInset);

  useEffect(() => {
    // Toolbar marks, block kinds and dictation change the buffer without an
    // onChangeText of their own, so the screen reports them here to hold off
    // the sync effect exactly like typing does.
    registerEditor(inputRef.current, () => {
      dirtyRef.current = true;
      editEpochRef.current += 1;
      appliedHtmlRef.current = null;
      appliedEnrichedRef.current = null;
    });
    return () => registerEditor(null);
  }, [registerEditor]);

  const htmlRef = useRef(html);
  htmlRef.current = html;
  const echoChecksRef = useRef(0);

  const syncBuffer = useCallback(() => {
    if (echoChecksRef.current > 0) return;
    const html = htmlRef.current;
    const enriched = toEnrichedHtml(html);
    if (dirtyRef.current) {
      const input = inputRef.current;
      if (focusedRef.current || !input) return;
      // An edit made with the field unfocused (dictation keeps running after
      // a blur) has no onBlur to settle it. It has settled once `html` holds
      // everything the buffer does; until then a later phrase is still
      // waiting on its flush and must stay protected. Remaining tail races
      // between several dictation phrases landing while unfocused are a
      // known limitation here, outside the focused-typing and cold-open paths.
      const epoch = editEpochRef.current;
      void input.getHTML().then(
        (live) => {
          if (editEpochRef.current !== epoch || focusedRef.current || htmlRef.current !== html)
            return;
          if (opsFromEnrichedHtml(html, live, 0).length > 0) return;
          dirtyRef.current = false;
          appliedHtmlRef.current = html;
          appliedEnrichedRef.current = enriched;
        },
        () => undefined
      );
      return;
    }
    if (enriched === appliedEnrichedRef.current) return;
    appliedHtmlRef.current = html;
    appliedEnrichedRef.current = enriched;
    inputRef.current?.setValue(enriched);
    onContentAppliedRef.current?.();
  }, []);

  useEffect(syncBuffer, [html, syncBuffer]);

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

  useEffect(() => {
    return () => {
      if (pressTouch.current) clearTimeout(pressTouch.current.handle);
    };
  }, []);

  function clearPressTouch() {
    if (pressTouch.current) clearTimeout(pressTouch.current.handle);
    pressTouch.current = null;
  }

  return (
    <View
      testID={`${testID}-shell`}
      style={{ flex: 1 }}
      onLayout={(event) => setShellHeight(event.nativeEvent.layout.height)}
      onTouchStart={
        onLongPress
          ? (event) => {
              clearPressTouch();
              const { pageX, pageY } = event.nativeEvent;
              pressTouch.current = {
                x: pageX,
                y: pageY,
                handle: setTimeout(() => {
                  pressTouch.current = null;
                  onLongPress();
                }, FORMAT_PRESS_MS),
              };
            }
          : undefined
      }
      onTouchMove={
        onLongPress
          ? (event) => {
              const touch = pressTouch.current;
              if (!touch) return;
              const dx = event.nativeEvent.pageX - touch.x;
              const dy = event.nativeEvent.pageY - touch.y;
              if (dx * dx + dy * dy > 16 * 16) clearPressTouch();
            }
          : undefined
      }
      onTouchEnd={onLongPress ? clearPressTouch : undefined}
      onTouchCancel={onLongPress ? clearPressTouch : undefined}
    >
      <EnrichedTextInput
        key={chapterId}
        ref={inputRef}
        testID={testID}
        defaultValue={toEnrichedHtml(html)}
        placeholder={placeholder}
        cursorColor={editorStyle.color}
        selectionColor="rgba(90, 140, 180, 0.35)"
        scrollEnabled
        submitBehavior="newline"
        linkRegex={null}
        autoCapitalize="sentences"
        contextMenuItems={
          onSetKind
            ? [
                {
                  text: t("manuscript.formatHeading"),
                  onPress: () => onSetKind("heading"),
                },
                {
                  text: t("manuscript.formatQuote"),
                  onPress: () => onSetKind("quote"),
                },
                {
                  text: t("manuscript.formatList"),
                  onPress: () => onSetKind("list_item"),
                },
                {
                  text: t("manuscript.formatParagraph"),
                  onPress: () => onSetKind("paragraph"),
                },
              ]
            : undefined
        }
        paragraphSpacing={paragraphSpacingFor(editorStyle.fontSize)}
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
          flex: 1,
          paddingBottom: bottomInset + typewriterPad,
          color: editorStyle.color,
          fontFamily: editorStyle.fontFamily,
          fontSize: editorStyle.fontSize,
          lineHeight: editorStyle.lineHeight,
        }}
        onFocus={() => {
          focusedRef.current = true;
          onFocused();
        }}
        onBlur={() => {
          focusedRef.current = false;
          dirtyRef.current = false;
          onBlurred();
        }}
        onChangeText={(e) => {
          const value = e.nativeEvent.value;
          const markEdited = () => {
            dirtyRef.current = true;
            editEpochRef.current += 1;
            appliedHtmlRef.current = null;
            appliedEnrichedRef.current = null;
            onChangeText(value);
          };
          const input = inputRef.current;
          if (dirtyRef.current || appliedHtmlRef.current == null || !input) {
            markEdited();
            return;
          }
          echoChecksRef.current += 1;
          const epoch = editEpochRef.current;
          void input
            .getHTML()
            .then(
              (enriched) => {
                const applied = appliedHtmlRef.current;
                return (
                  editEpochRef.current === epoch &&
                  applied != null &&
                  opsFromEnrichedHtml(applied, enriched, 0).length === 0
                );
              },
              () => false
            )
            .then((echo) => {
              echoChecksRef.current -= 1;
              // The native editor's own echo of the setValue the sync effect
              // just applied, not something the user typed: ignore it, and
              // apply any correction that arrived while this was checked.
              if (echo) syncBuffer();
              else markEdited();
            });
        }}
        onChangeState={(e) => onChangeState(e.nativeEvent)}
        onChangeSelection={(e) => onChangeSelection(e.nativeEvent.start, e.nativeEvent.end)}
      />
    </View>
  );
}
