import { useEffect } from "react";
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

export function AppHeader({
  title,
  onBack,
  backAccessibilityLabel,
  onSettings,
  onNew,
  newExpanded = false,
}: {
  title: string;
  onBack?: () => void;
  backAccessibilityLabel?: string;
  onSettings?: () => void;
  onNew?: () => void;
  /** When true, the "+" rotates into an "×" - used when it toggles a menu. */
  newExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
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
    <View style={[styles.root, { paddingTop: insets.top + 14, backgroundColor: colors.bg }]}>
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
        {onSettings || onNew ? (
          <View style={styles.actions}>
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
                accessibilityLabel={t("manuscripts.newA11y")}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 20, paddingBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  lead: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0 },
  title: { flex: 1, fontFamily: fonts.serif, fontSize: 26 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  newBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
});
