import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ChapterEditor } from "../ChapterEditor";
import { OnboardingHeader } from "./OnboardingHeader";
import { TapPressable } from "../TapPressable";
import { useAppTheme } from "../../lib/settings";
import { useStackBack } from "../../lib/use-stack-back";
import { useReduceMotion } from "../../lib/use-reduce-motion";
import { getAnalytics } from "../../lib/analytics-client";
import { fonts } from "../../lib/theme";
import { FOCUS_TRANSITION_MS } from "../../lib/focus-mode";
import type { DemoPath } from "../../lib/onboarding";
import { FocusIcon } from "../icons";
import * as haptics from "../../lib/haptics";

const DEMO_CHAPTER_ID = "onboarding-demo-focus";

/**
 * Storyboard 1: a short seeded page, "Try Focus mode" hides everything but
 * the page (the real `ChapterEditor`, with typewriter on), the user may type
 * a line of their own. Local state only - nothing here is saved.
 */
export function FocusDemo({
  path,
  onContinue,
  onSkip,
}: {
  path: DemoPath;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { colors, layout, settings } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [on, setOn] = useState(false);
  // `onChangeText` reports plain text, not HTML (see ChapterEditor) - the
  // sample page never changes under the editor, so the user's own typing
  // stays entirely inside the native view and is never read back here.
  const html = `<p>${t("onboarding.demo.focus.sample")}</p>`;
  const fade = reduceMotion ? undefined : FadeIn.duration(FOCUS_TRANSITION_MS);
  const unfade = reduceMotion ? undefined : FadeOut.duration(FOCUS_TRANSITION_MS);

  useEffect(() => {
    getAnalytics().track("onboarding_demo_viewed", { path });
  }, [path]);

  function tryFocus() {
    haptics.impact("medium");
    setOn(true);
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
    <View style={layout.screen}>
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
          <OnboardingHeader onBack={() => backOr("/")} onSkip={onSkip} />
          <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <Text style={[layout.title, { fontSize: 22 }]}>{t("onboarding.demo.focus.title")}</Text>
            <Text style={[layout.body, { marginTop: 6, marginBottom: 14 }]}>
              {t("onboarding.demo.focus.intro")}
            </Text>
            <Pressable
              onPress={tryFocus}
              accessibilityRole="button"
              accessibilityLabel={t("onboarding.demo.focus.tryButton")}
              style={({ pressed }) => ({
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
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <FocusIcon color={colors.accent} size={16} />
              <Text style={{ color: colors.ink, fontWeight: "600" }}>
                {t("onboarding.demo.focus.tryButton")}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 8 }}>
        <ChapterEditor
          chapterId={DEMO_CHAPTER_ID}
          html={html}
          editorStyle={editorStyle}
          resumeOffset={null}
          typewriter={on}
          onFocused={() => {}}
          onBlurred={() => {}}
          onChangeText={() => {}}
          onChangeState={() => {}}
          onChangeSelection={() => {}}
          registerEditor={() => {}}
          testID="onboarding-focus-editor"
        />
      </View>

      {on ? null : (
        <Animated.View entering={fade} exiting={unfade} style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 8 }}>
          <TapPressable
            onPress={finish}
            accessibilityRole="button"
            accessibilityLabel={t("onboarding.demo.continue")}
            style={layout.primaryBtn}
          >
            <Text style={layout.primaryBtnText}>{t("onboarding.demo.continue")}</Text>
          </TapPressable>
        </Animated.View>
      )}
    </View>
  );
}
