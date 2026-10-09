import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { CheckIcon } from "./icons";
import * as haptics from "../lib/haptics";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { usePressFeedback } from "../lib/use-press-feedback";
import { useSelectionPop } from "../lib/use-selection-pop";
import { fonts, THEME_META, THEME_PALETTES, type ThemeId } from "../lib/theme";

/**
 * A theme as a small page painted in its own colours: the desk, a sheet of
 * paper with three lines of ink (the first in the accent), and the name. Used
 * by the onboarding "Pick a look" step and Settings' theme sheet, so a theme
 * reads the same in both.
 */
export function ThemeCard({
  theme,
  selected,
  onPress,
}: {
  theme: ThemeId;
  selected: boolean;
  onPress: (event: GestureResponderEvent) => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const palette = THEME_PALETTES[theme];
  const mode = THEME_META.find((meta) => meta.id === theme)?.mode ?? "light";
  const { progress } = useSelectionPop(selected, reduceMotion);
  // A press dips the card and nothing else: the engine without its tint, since
  // TapPressable's tint would repaint the card's own desk colour in the current
  // theme and blank its swatch.
  const press = usePressFeedback({ feedback: "scale" });

  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
  }));
  const badge = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.4, 1]) }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, press.animatedStyle]}>
    <Pressable
      onPress={haptics.withTap(onPress)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${t(`themes.${theme}`)}, ${t(`themes.${mode}`)}`}
      style={[styles.card, { backgroundColor: palette.bg, borderColor: palette.line }]}
    >
      <View style={[styles.page, { backgroundColor: palette.panel, borderColor: palette.line }]}>
        <View style={[styles.line, { width: "58%", backgroundColor: palette.accent }]} />
        <View style={[styles.line, { width: "88%", backgroundColor: palette.ink, opacity: 0.55 }]} />
        <View style={[styles.line, { width: "74%", backgroundColor: palette.ink, opacity: 0.55 }]} />
        <View style={[styles.line, { width: "36%", backgroundColor: palette.ink, opacity: 0.55 }]} />
      </View>
      <Text style={[styles.name, { color: palette.ink }]} numberOfLines={1}>
        {t(`themes.${theme}`)}
      </Text>
      <Text style={[styles.mode, { color: palette.inkSoft }]}>{t(`themes.${mode}`)}</Text>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.ring, { borderColor: palette.accent }, ring]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.badge, { backgroundColor: palette.accent }, badge]}
      >
        <CheckIcon color={palette.onAccent} size={12} />
      </Animated.View>
    </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    overflow: "hidden",
  },
  page: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 6,
    height: 64,
    marginBottom: 8,
  },
  line: { height: 4, borderRadius: 2 },
  name: { fontFamily: fonts.uiBold, fontSize: 14 },
  mode: { fontFamily: fonts.ui, fontSize: 11, marginTop: 1 },
  ring: { borderRadius: 16, borderWidth: 2 },
  badge: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
