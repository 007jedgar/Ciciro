import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ChapterEditor } from "../ChapterEditor";
import { OnboardingHeader } from "./OnboardingHeader";
import { KeyboardDoneBar } from "./KeyboardDoneBar";
import { OnboardingThread } from "./OnboardingThread";
import { PressableCard } from "../PressableCard";
import { TapPressable } from "../TapPressable";
import { useAppTheme } from "../../lib/settings";
import { useStackBack } from "../../lib/use-stack-back";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import { getAnalytics } from "../../lib/analytics-client";
import { fonts } from "../../lib/theme";
import { FOCUS_TRANSITION_MS } from "../../lib/focus-mode";
import type { DemoPath } from "../../lib/onboarding";
import type { OnboardingStep } from "../../lib/onboarding-flow";
import { FocusIcon } from "../icons";
import * as haptics from "../../lib/haptics";

const DEMO_CHAPTER_ID = "onboarding-demo-focus";
/** From this text size up the intro and the page scroll together, and the page keeps at least this much height. */
const LARGE_TEXT_SCALE = 1.3;
const LARGE_TEXT_PAGE_HEIGHT = 320;
/** Enough prose to scroll through, so the demo is a page and not a single line. */
const SAMPLE_KEYS = ["sample", "sample2", "sample3", "sample4"] as const;

/**
 * Storyboard 1: a seeded page of prose (or, for a journal, a blank one) in the
 * real `ChapterEditor`, which is a real text editor from the first frame: scroll
 * it, put the cursor anywhere, type and delete. "Try focus mode" hides
 * everything but the page and turns typewriter scrolling on. Local state only -
 * nothing here is saved.
 */
export function FocusDemo({
  path,
  steps,
  blankPage = false,
  onContinue,
  onSkip,
}: {
  path: DemoPath;
  steps: readonly OnboardingStep[];
  blankPage?: boolean;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { colors, layout, settings } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [on, setOn] = useState(false);
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > LARGE_TEXT_SCALE;
  // `onChangeText` reports plain text, not HTML (see ChapterEditor) - the
  // sample page never changes under the editor, so the user's own typing
  // stays entirely inside the native view and is never read back here.
  const html = blankPage
    ? ""
    : SAMPLE_KEYS.map((key) => `<p>${t(`onboarding.demo.focus.${key}`)}</p>`).join("");
  const fade = reduceMotion ? undefined : FadeIn.duration(FOCUS_TRANSITION_MS);
  const unfade = reduceMotion ? undefined : FadeOut.duration(FOCUS_TRANSITION_MS);

  useEffect(() => {
    getAnalytics().track("onboarding_demo_viewed", { path });
  }, [path]);

  function tryFocus() {
    haptics.impact("medium");
    setOn(true);
  }

  // Works with any keyboard: tapping outside the page and the Done bar both end up here.
  function dismissKeyboard() {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }

  function finish() {
    getAnalytics().track("onboarding_demo_completed", { path });
    onContinue();
  }

  const editorStyle = {
    fontFamily: settings.editorFont === "sans" ? fonts.sans : fonts.serif,
    fontSize: settings.editorFontSize,
    lineHeight: Math.round(settings.editorFontSize * 1.55),
    color: colors.ink,
  };

  return (
    // The keyboard lifts the page instead of covering it, so the line being
    // typed is always in view.
    <KeyboardAvoidingView style={layout.screen} behavior="padding" automaticOffset>
      {on ? (
        <Animated.View
          entering={fade}
          exiting={unfade}
          style={{ paddingHorizontal: 20, alignItems: "flex-end", paddingTop: insets.top + 14 }}
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
      ) : (
        <Animated.View entering={fade} exiting={unfade}>
          <OnboardingHeader
            onBack={() => backOr("/")}
            onSkip={onSkip}
            thread={<OnboardingThread steps={steps} current="demo" />}
          />
        </Animated.View>
      )}

      {/* The intro and the page share one scroller: at a large text size the
          intro would otherwise leave the page no height, so it scrolls away
          instead. The editor keeps its place in this tree, so toggling focus
          mode never remounts it (and never loses what was typed). */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEnabled={largeText && !on}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {on ? null : (
          <Animated.View entering={fade} exiting={unfade}>
            <Pressable
              onPress={dismissKeyboard}
              accessible={false}
              style={{ paddingHorizontal: 20, paddingTop: 16 }}
            >
              <Text style={[layout.title, { fontSize: 22 }]}>{t("onboarding.demo.focus.title")}</Text>
              <Text style={[layout.body, { marginTop: 6, marginBottom: 14 }]}>
                {t("onboarding.demo.focus.intro")}
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
          </Animated.View>
        )}

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
            html={html}
            editorStyle={editorStyle}
            placeholder={blankPage ? t("onboarding.demo.focus.journalPlaceholder") : undefined}
            resumeOffset={null}
            typewriter={on}
            onFocused={() => {}}
            onBlurred={() => {}}
            onChangeText={() => {}}
            onChangeState={() => {}}
            onChangeSelection={() => {}}
            registerEditor={(ref) => {
              editorRef.current = ref;
            }}
            testID="onboarding-focus-editor"
          />
        </View>
      </ScrollView>

      {keyboardVisible ? (
        <KeyboardDoneBar onPress={dismissKeyboard} />
      ) : on ? null : (
        <Animated.View entering={fade} exiting={unfade} style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 8 }}>
          <PressableCard
            accent
            onPress={finish}
            accessibilityRole="button"
            accessibilityLabel={t("onboarding.demo.continue")}
            style={[layout.primaryBtn, { marginTop: 0 }]}
          >
            <Text style={layout.primaryBtnText}>{t("onboarding.demo.continue")}</Text>
          </PressableCard>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}
