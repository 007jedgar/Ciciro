import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, Text, View } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import type { EnrichedTextInputInstance } from "react-native-enriched-html";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { ChapterEditor } from "../ChapterEditor";
import { SuggestionsPill, SuggestionsSheet } from "../SuggestionsReview";
import { KeyboardDoneBar } from "./KeyboardDoneBar";
import { PressableCard } from "../PressableCard";
import { useAppTheme } from "../../lib/settings";
import { useStackBack } from "../../lib/use-stack-back";
import { getAnalytics } from "../../lib/analytics-client";
import { useOnboardingChrome } from "../../lib/onboarding-shell";
import { fonts } from "../../lib/theme";
import type { DemoPath } from "../../lib/onboarding";
import type { OnboardingStep } from "../../lib/onboarding-flow";
import { CICIRO_AUTHOR, listSuggestions, resolveSuggestions, type SuggestionAction } from "../../lib/suggestions";

const DEMO_CHAPTER_ID = "onboarding-demo-suggestions";
const DEMO_SUGGESTION_ID = "sg-onboarding-demo";

/** The sentence with its clunky phrase wrapped in a real tracked-change mark, timestamped now so it reads "just now" like a fresh suggestion. */
function demoHtml(sentence: string, clunky: string, better: string): string {
  const at = sentence.indexOf(clunky);
  if (at < 0) return `<p data-block-id="demo-1">${sentence}</p>`;
  const before = sentence.slice(0, at);
  const after = sentence.slice(at + clunky.length);
  const attrs = `data-suggestion-id="${DEMO_SUGGESTION_ID}" data-author-id="${CICIRO_AUTHOR.authorId}" data-author-name="${CICIRO_AUTHOR.authorName}" data-created-at="${new Date().toISOString()}"`;
  return `<p data-block-id="demo-1">${before}<del ${attrs}>${clunky}</del><ins ${attrs}>${better}</ins>${after}</p>`;
}

/**
 * Storyboard 6: a pre-written sentence with one clunky word, shown as the
 * real tracked-change underline/strikethrough with the real Accept/Reject
 * card. Local state only - nothing here is saved, and no AI call ever runs.
 */
export function SuggestionsDemo({
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
  const [html, setHtml] = useState(() =>
    demoHtml(
      t("onboarding.demo.suggestions.sentence"),
      t("onboarding.demo.suggestions.clunky"),
      t("onboarding.demo.suggestions.better")
    )
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const completedRef = useRef(false);
  const editorRef = useRef<EnrichedTextInputInstance | null>(null);
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const suggestions = useMemo(() => listSuggestions(html), [html]);
  useOnboardingChrome({ step: "demo", steps, onBack: () => backOr("/"), onSkip });

  useEffect(() => {
    getAnalytics().track("onboarding_demo_viewed", { path });
  }, [path]);

  // Tapping outside the page and the Done bar both close the keyboard, so Continue is never stranded behind it.
  function dismissKeyboard() {
    editorRef.current?.blur();
    Keyboard.dismiss();
  }

  function markCompleted() {
    if (completedRef.current) return;
    completedRef.current = true;
    getAnalytics().track("onboarding_demo_completed", { path });
  }

  function resolve(action: SuggestionAction, ids?: string[]) {
    setHtml((current) => resolveSuggestions(current, action, ids ?? null));
    markCompleted();
  }

  const editorStyle = {
    fontFamily: settings.editorFont === "sans" ? fonts.sans : fonts.serif,
    fontSize: settings.editorFontSize,
    lineHeight: Math.round(settings.editorFontSize * 1.55),
    color: colors.ink,
  };

  return (
    <KeyboardAvoidingView style={layout.screen} behavior="padding" automaticOffset>
      <Pressable onPress={dismissKeyboard} accessible={false} style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <Text style={[layout.title, { fontSize: 22 }]}>{t("onboarding.demo.suggestions.title")}</Text>
        <Text style={[layout.body, { marginTop: 6, marginBottom: 14 }]}>
          {t("onboarding.demo.suggestions.intro")}
        </Text>
      </Pressable>
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <SuggestionsPill suggestions={suggestions} onOpen={() => setReviewOpen(true)} />
      </View>
      <View style={{ flex: 1, paddingHorizontal: 20 }}>
        <ChapterEditor
          chapterId={DEMO_CHAPTER_ID}
          html={html}
          editorStyle={editorStyle}
          resumeOffset={null}
          onFocused={() => {}}
          onBlurred={() => {}}
          // `onChangeText` reports plain text, not HTML - `html` only ever
          // changes through resolveSuggestions below.
          onChangeText={() => {}}
          onChangeState={() => {}}
          onChangeSelection={() => {}}
          registerEditor={(ref) => {
            editorRef.current = ref;
          }}
          testID="onboarding-suggestions-editor"
        />
      </View>
      <SuggestionsSheet
        visible={reviewOpen}
        suggestions={suggestions}
        onClose={() => setReviewOpen(false)}
        onResolve={resolve}
      />
      {keyboardVisible ? (
        <KeyboardDoneBar onPress={dismissKeyboard} />
      ) : (
      <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 8 }}>
        <PressableCard
          accent
          onPress={() => {
            markCompleted();
            onContinue();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.demo.continue")}
          style={[layout.primaryBtn, { marginTop: 0 }]}
        >
          <Text style={layout.primaryBtnText}>{t("onboarding.demo.continue")}</Text>
        </PressableCard>
      </View>
      )}
    </KeyboardAvoidingView>
  );
}
