import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import type { EnrichedTextInputInstance, OnChangeStateEvent } from "react-native-enriched-html";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { ChapterEditor } from "../ChapterEditor";
import { ScreenplayBar } from "../ScreenplayBar";
import { FocusCollapse } from "./FocusCollapse";
import { KeyboardDoneBar } from "./KeyboardDoneBar";
import { PressableCard } from "../PressableCard";
import { TapPressable } from "../TapPressable";
import { useAppTheme } from "../../lib/settings";
import { useStackBack } from "../../lib/use-stack-back";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import { getAnalytics } from "../../lib/analytics-client";
import { useOnboardingChrome, useOnboardingShell } from "../../lib/onboarding-shell";
import { fonts } from "../../lib/theme";
import { FOCUS_BAR_HEIGHT, FOCUS_TRANSITION_MS } from "../../lib/focus-mode";
import { applyOpsToDoc, appendEmptyBlockOps, REPLACE_FLUSH_MS, setBlockElementOps } from "../../lib/block-editor";
import { blockAtPlainOffset, opsFromEnrichedHtml } from "../../lib/enriched-html";
import { docToHtml, htmlToDoc, type ManuscriptOp } from "../../lib/manuscript";
import { knownElement, type ScreenplayElement } from "../../lib/manuscript-kind";
import { capsText, setsCaps, withElement } from "../../lib/screenplay";
import { caretBeyondChapter, elementTagAtCaret, elementTargetId } from "../../lib/screenplay-live";
import { useScriptLayout } from "../../lib/script-layout";
import { useScriptLanguageSupported } from "../../lib/script-language";
import type { DemoPath } from "../../lib/onboarding";
import type { OnboardingStep } from "../../lib/onboarding-flow";
import { FocusIcon } from "../icons";
import * as haptics from "../../lib/haptics";

const DEMO_CHAPTER_ID = "onboarding-demo-screenplay";
const LARGE_TEXT_SCALE = 1.3;
const LARGE_TEXT_PAGE_HEIGHT = 320;

/** The scene, as one block per element, in the order it is shown. */
const SAMPLE_BLOCKS: { key: string; element: ScreenplayElement }[] = [
  { key: "sceneHeading", element: "scene-heading" },
  { key: "action", element: "action" },
  { key: "character", element: "character" },
  { key: "parenthetical", element: "parenthetical" },
  { key: "dialogue", element: "dialogue" },
];

function sampleScript(t: (key: string) => string): string {
  return SAMPLE_BLOCKS.map(({ key, element }) =>
    withElement(`<p>${capsText(element, t(`onboarding.demo.screenplay.${key}`))}</p>`, element)
  ).join("");
}

/**
 * Storyboard for a screenplay answer: the real screenplay editor (element-aware
 * formatting, auto-caps, the `ScreenplayBar` element toolbar) on a seeded short
 * scene, instead of the prose `FocusDemo`. "Try focus mode" still collapses the
 * onboarding chrome around it, exactly as it does in `FocusDemo` - focus mode
 * is a generic writing feature, not specific to a kind, and the real editor
 * keeps its screenplay toolbar up through focus mode too. Name chips (bible
 * completions) and dual dialogue are left out: there is no story bible here,
 * and a single-character scene has nothing to pair. Local state only - nothing
 * here is saved or synced, same as `FocusDemo`.
 */
export function ScreenplayDemo({
  path,
  steps,
  onContinue,
  onSkip,
}: {
  path: DemoPath;
  steps: readonly OnboardingStep[];
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { colors, layout, settings } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [on, setOn] = useState(false);
  const [focused, setFocused] = useState(false);
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const keyboardVisible = useKeyboardState((state) => state.isVisible);

  const scriptLayoutOn = useScriptLayout();
  const scriptLanguage = useScriptLanguageSupported();
  const nativeScript = scriptLayoutOn && scriptLanguage;

  const [content, setContent] = useState(() => sampleScript(t));
  const [revision, setRevision] = useState(0);
  const contentRef = useRef(content);
  contentRef.current = content;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const liveTextRef = useRef<string | null>(null);
  const caretRef = useRef({ blockId: "", docOffset: 0 });
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [caretElement, setCaretElement] = useState<string>("scene-heading");

  const { focus, headerHeight, setFocusHidden } = useOnboardingShell();
  useOnboardingChrome({ step: "demo", steps, onBack: () => backOr("/"), onSkip });
  useEffect(() => {
    focus.value = withTiming(on ? 1 : 0, { duration: reduceMotion ? 1 : FOCUS_TRANSITION_MS });
    setFocusHidden(on);
  }, [on, reduceMotion, focus, setFocusHidden]);
  useEffect(
    () => () => {
      focus.value = 0;
      setFocusHidden(false);
    },
    [focus, setFocusHidden]
  );
  const exitBarStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
    transform: [{ translateY: -12 * (1 - focus.value) - headerHeight.value * (1 - focus.value) }],
  }));
  const focusTopSpace = insets.top + FOCUS_BAR_HEIGHT;
  const focusTopStyle = useAnimatedStyle(() => ({ height: focusTopSpace * focus.value }));

  useEffect(() => {
    getAnalytics().track("onboarding_demo_viewed", { path });
  }, [path]);

  function tryFocus() {
    haptics.impact("medium");
    setOn(true);
  }

  function dismissKeyboard() {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }

  function finish() {
    getAnalytics().track("onboarding_demo_completed", { path });
    onContinue();
  }

  const commitOps = useCallback((ops: ManuscriptOp[]) => {
    if (ops.length === 0) return;
    const next = applyOpsToDoc(htmlToDoc(contentRef.current, revisionRef.current).doc, ops);
    const nextContent = docToHtml(next);
    contentRef.current = nextContent;
    revisionRef.current = next.revision;
    setContent(nextContent);
    setRevision(next.revision);
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const editor = editorRef.current;
    if (!editor) return false;
    let enriched: string;
    try {
      enriched = await editor.getHTML();
    } catch {
      return false;
    }
    commitOps(
      opsFromEnrichedHtml(contentRef.current, enriched, revisionRef.current, undefined, {
        screenplay: true,
        nativeElements: nativeScript,
      })
    );
    return true;
  }, [commitOps, nativeScript]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      void flush();
    }, REPLACE_FLUSH_MS);
  }, [flush]);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    []
  );

  const recomputeElement = useCallback(() => {
    // The native editor reports the element under the caret itself (onChangeState).
    if (nativeScript) return;
    const tag = elementTagAtCaret(contentRef.current, liveTextRef.current, caretRef.current.docOffset);
    setCaretElement((previous) => (previous === tag ? previous : tag));
  }, [nativeScript]);

  const onChangeText = useCallback(
    (text: string) => {
      liveTextRef.current = text;
      recomputeElement();
      scheduleFlush();
    },
    [recomputeElement, scheduleFlush]
  );

  const onContentApplied = useCallback(() => {
    liveTextRef.current = null;
  }, []);

  const onCaret = useCallback(
    (start: number) => {
      const at = blockAtPlainOffset(contentRef.current, start);
      caretRef.current = { blockId: at?.blockId ?? "", docOffset: start };
      recomputeElement();
    },
    [recomputeElement]
  );

  const onChangeState = useCallback(
    (state: OnChangeStateEvent) => {
      if (!nativeScript) return;
      const tag = state.screenplay || "action";
      setCaretElement((previous) => (previous === tag ? previous : tag));
    },
    [nativeScript]
  );

  const onSetElement = useCallback(
    async (element: ScreenplayElement) => {
      setCaretElement(element);
      if (nativeScript) {
        editorRef.current?.setScreenplayElement(element);
        await flush();
        return;
      }
      await flush();
      const doc = htmlToDoc(contentRef.current, revisionRef.current).doc;
      if (caretBeyondChapter(contentRef.current, caretRef.current.docOffset)) {
        commitOps(appendEmptyBlockOps(doc, element));
        return;
      }
      const target =
        elementTargetId(contentRef.current, caretRef.current.docOffset, caretRef.current.blockId) ||
        doc.blocks[doc.blocks.length - 1]?.id;
      if (!target) return;
      commitOps(setBlockElementOps(doc, target, element));
    },
    [commitOps, flush, nativeScript]
  );

  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > LARGE_TEXT_SCALE;

  const editorStyle = useMemo(
    () => ({
      fontFamily: settings.editorFont === "sans" ? fonts.sans : fonts.serif,
      fontSize: settings.editorFontSize,
      lineHeight: Math.round(settings.editorFontSize * 1.55),
      color: colors.ink,
    }),
    [settings.editorFont, settings.editorFontSize, colors.ink]
  );

  return (
    <KeyboardAvoidingView style={layout.screen} behavior="padding" automaticOffset>
      <Animated.View style={focusTopStyle} />
      <Animated.View
        pointerEvents={on ? "auto" : "none"}
        style={[
          { position: "absolute", top: insets.top + 14, right: 20, zIndex: 5 },
          exitBarStyle,
        ]}
      >
        <TapPressable
          onPress={() => setOn(false)}
          accessibilityRole="button"
          accessibilityLabel={t("settings.exitFocus")}
          hitSlop={10}
          style={{ paddingVertical: 8 }}
        >
          <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{t("settings.exitFocus")}</Text>
        </TapPressable>
      </Animated.View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEnabled={largeText && !on}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FocusCollapse progress={focus} direction={-1} hidden={on}>
          <Pressable
            onPress={dismissKeyboard}
            accessible={false}
            style={{ paddingHorizontal: 20, paddingTop: 16 }}
          >
            <Text style={[layout.title, { fontSize: 22 }]}>{t("onboarding.demo.screenplay.title")}</Text>
            <Text style={[layout.body, { marginTop: 6, marginBottom: 14 }]}>
              {t("onboarding.demo.screenplay.intro")}
            </Text>
            <PressableCard
              onPress={tryFocus}
              accessibilityRole="button"
              accessibilityLabel={t("onboarding.demo.focus.tryButton")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                alignSelf: "flex-start",
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.panel,
                borderRadius: 999,
                paddingVertical: 10,
                paddingHorizontal: 16,
              }}
            >
              <FocusIcon color={colors.accent} size={16} />
              <Text style={{ color: colors.ink, fontWeight: "600" }}>
                {t("onboarding.demo.focus.tryButton")}
              </Text>
            </PressableCard>
          </Pressable>
        </FocusCollapse>

        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            paddingTop: 8,
            minHeight: largeText && !on ? LARGE_TEXT_PAGE_HEIGHT : 0,
          }}
        >
          <ChapterEditor
            chapterId={DEMO_CHAPTER_ID}
            html={content}
            editorStyle={editorStyle}
            resumeOffset={null}
            typewriter={on}
            scriptLayout={nativeScript}
            capitals={setsCaps(caretElement)}
            onFocused={() => setFocused(true)}
            onBlurred={() => {
              setFocused(false);
              void flush();
            }}
            onChangeText={onChangeText}
            onContentApplied={onContentApplied}
            onChangeState={onChangeState}
            onChangeSelection={onCaret}
            registerEditor={(ref) => {
              editorRef.current = ref;
            }}
            testID="onboarding-screenplay-editor"
          />
        </View>
      </ScrollView>

      <View style={{ marginBottom: keyboardVisible ? 0 : 8 }}>
        <ScreenplayBar
          element={knownElement(caretElement)}
          disabled={!focused}
          onSetElement={(element) => void onSetElement(element)}
        />
      </View>

      {keyboardVisible ? (
        <KeyboardDoneBar onPress={dismissKeyboard} />
      ) : (
        <FocusCollapse progress={focus} direction={1} hidden={on}>
          <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 8 }}>
            <PressableCard
              accent
              onPress={finish}
              accessibilityRole="button"
              accessibilityLabel={t("onboarding.demo.continue")}
              style={[layout.primaryBtn, { marginTop: 0 }]}
            >
              <Text style={layout.primaryBtnText}>{t("onboarding.demo.continue")}</Text>
            </PressableCard>
          </View>
        </FocusCollapse>
      )}
    </KeyboardAvoidingView>
  );
}
