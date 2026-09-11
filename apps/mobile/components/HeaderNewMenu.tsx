import { Fragment, useEffect, type ReactElement } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { Glass, alpha } from "./Glass";

const SPRING = { damping: 15, stiffness: 190, mass: 0.7 } as const;

export type NewMenuItem = {
  key: string;
  label: string;
  Icon: (p: { color: string; size?: number }) => ReactElement;
  onPress: () => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A frosted drop-down that springs out of the header's "+" button, mirroring the
 * manuscript tab bar's action menu. Anchored to the top-right so it grows down
 * from the button.
 */
export function HeaderNewMenu({
  open,
  onClose,
  items,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  items: NewMenuItem[];
  closeLabel: string;
}) {
  const { colors, dark } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion
      ? withTiming(open ? 1 : 0, { duration: 120 })
      : withSpring(open ? 1 : 0, SPRING);
  }, [open, reduceMotion, progress]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 1], [0, 0.4]) }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], "clamp"),
    transform: [
      { scale: reduceMotion ? 1 : interpolate(progress.value, [0, 1], [0.9, 1]) },
      { translateY: reduceMotion ? 0 : interpolate(progress.value, [0, 1], [-8, 0]) },
    ],
  }));

  function choose(item: NewMenuItem) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onClose();
    item.onPress();
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents={open ? "auto" : "none"}>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
      />
      <Animated.View style={[styles.panelWrap, { top: insets.top + 70 }, panelStyle]}>
        <Glass dark={dark} colors={colors} radius={22} style={styles.panel}>
          {items.map((item, i) => (
            <Fragment key={item.key}>
              {i > 0 ? (
                <View style={[styles.divider, { backgroundColor: alpha(colors.line, 0.7) }]} />
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => choose(item)}
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View
                  style={[
                    styles.rowIcon,
                    { backgroundColor: alpha(colors.panel2, dark ? 0.55 : 0.7), borderColor: alpha(colors.line, 0.7) },
                  ]}
                >
                  <item.Icon color={colors.ink} size={21} />
                </View>
                <Text style={[styles.rowLabel, { color: colors.ink }]}>{item.label}</Text>
              </Pressable>
            </Fragment>
          ))}
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 15 },
  scrim: { backgroundColor: "#000" },
  panelWrap: { position: "absolute", right: 16, transformOrigin: "100% 0%" },
  panel: { paddingVertical: 6, minWidth: 224 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 12 },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 15, fontWeight: "500" },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
});
