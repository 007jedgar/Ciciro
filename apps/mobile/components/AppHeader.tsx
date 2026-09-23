import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInLeft,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import { ChevronLeftIcon, PlusIcon, SlidersIcon } from "./icons";
import { ProgressiveBlur } from "./ProgressiveBlur";

const TOP_GAP = 14;
const ROW_HEIGHT = 38;
const BOTTOM_GAP = 16;
/** How far the blur keeps fading past the header's bottom edge. */
const BLUR_TAIL = 28;

/**
 * A layout that floats a header over nested screens publishes its measured
 * height here, since an accessory row under the header changes it.
 */
export const AppHeaderHeightContext = createContext<number | null>(null);

/**
 * Height of the header, so a screen using a floating header can start its
 * scroll content just below it.
 */
export function useAppHeaderHeight(): number {
  const measured = useContext(AppHeaderHeightContext);
  const top = useSafeAreaInsets().top;
  return measured ?? top + TOP_GAP + ROW_HEIGHT + BOTTOM_GAP;
}

export function AppHeader({
  title,
  onBack,
  backAccessibilityLabel,
  onSettings,
  onNew,
  newAccessibilityLabel,
  newExpanded = false,
  actionLabel,
  onAction,
  actionDisabled = false,
  floating = false,
  accessory,
  onHeightChange,
}: {
  title: string;
  onBack?: () => void;
  backAccessibilityLabel?: string;
  onSettings?: () => void;
  onNew?: () => void;
  /** When true, the "+" rotates into an "×" - used when it toggles a menu. */
  newExpanded?: boolean;
  newAccessibilityLabel?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  /**
   * Float over the screen with a progressive blur so content scrolls under it.
   * The screen must pad its scroll content by `useAppHeaderHeight()`.
   */
  floating?: boolean;
  /** A full-width row under the title, kept inside the header's blur. */
  accessory?: ReactNode;
  onHeightChange?: (height: number) => void;
}) {
  const { t } = useTranslation();
  const { colors, dark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const newProgress = useSharedValue(0);

  useEffect(() => {
    newProgress.value = reduceMotion
      ? withTiming(newExpanded ? 1 : 0, { duration: 120 })
      : withSpring(newExpanded ? 1 : 0, { damping: 15, stiffness: 190, mass: 0.7 });
  }, [newExpanded, reduceMotion, newProgress]);

  const newIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(newProgress.value, [0, 1], [0, 45])}deg` }],
  }));

  function handleBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onBack?.();
  }

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + TOP_GAP },
        floating ? styles.floating : { backgroundColor: colors.bg },
      ]}
      onLayout={
        onHeightChange ? (event) => onHeightChange(event.nativeEvent.layout.height) : undefined
      }
    >
      {floating ? (
        <ProgressiveBlur dark={dark} color={colors.bg} style={{ bottom: -BLUR_TAIL }} />
      ) : null}
      <View style={styles.row}>
        <View style={styles.lead}>
          {onBack ? (
            <Animated.View entering={reduceMotion ? undefined : FadeInLeft.duration(220)}>
              <Pressable
                onPress={handleBack}
                accessibilityRole="button"
                accessibilityLabel={backAccessibilityLabel ?? t("common.back")}
                hitSlop={10}
                style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
              >
                <ChevronLeftIcon color={colors.ink} />
              </Pressable>
            </Animated.View>
          ) : null}
          <Animated.Text
            key={title}
            entering={reduceMotion ? undefined : FadeIn.duration(180)}
            numberOfLines={1}
            accessibilityRole="header"
            style={[styles.title, { color: colors.ink }]}
          >
            {title}
          </Animated.Text>
        </View>
        {onSettings || onNew || onAction ? (
          <View style={styles.actions}>
            {onAction && actionLabel ? (
              <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
                <Pressable
                  onPress={onAction}
                  disabled={actionDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={actionLabel}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    {
                      backgroundColor: actionDisabled ? colors.panel2 : colors.accent,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Animated.Text
                    style={[
                      styles.actionText,
                      { color: actionDisabled ? colors.inkSoft : colors.panel },
                    ]}
                  >
                    {actionLabel}
                  </Animated.Text>
                </Pressable>
              </Animated.View>
            ) : null}
            {onSettings ? (
              <Pressable
                onPress={onSettings}
                accessibilityRole="button"
                accessibilityLabel={t("common.settings")}
                hitSlop={10}
                style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
              >
                <SlidersIcon color={colors.inkSoft} />
              </Pressable>
            ) : null}
            {onNew ? (
              <Pressable
                onPress={onNew}
                accessibilityRole="button"
                accessibilityState={{ expanded: newExpanded }}
                accessibilityLabel={newAccessibilityLabel ?? t("manuscripts.newA11y")}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.newBtn,
                  { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Animated.View style={newIconStyle}>
                  <PlusIcon color={colors.panel} />
                </Animated.View>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingBottom: BOTTOM_GAP },
  floating: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  // The accessory brings its own side and bottom padding.
  accessory: { marginHorizontal: -20, marginTop: 12, marginBottom: -BOTTOM_GAP },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  lead: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0 },
  title: { flex: 1, fontFamily: fonts.serif, fontSize: 26 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  actionBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontSize: 14, fontWeight: "600" },
  newBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
});
