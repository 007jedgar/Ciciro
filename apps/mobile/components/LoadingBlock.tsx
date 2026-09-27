import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useOptionalAppTheme } from "../lib/settings";
import { fadeUpDelay } from "../lib/skeleton";
import { colors as parchment } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { Skeleton } from "./Skeleton";
import { ShimmerText } from "./ShimmerText";

/** Line widths that read as ragged prose rather than a bar chart. */
const LINE_WIDTHS: (`${number}%`)[] = ["100%", "92%", "96%", "84%", "100%", "68%"];

/**
 * What stands in for text that Ciciro is still working on: a shimmering status
 * line, then grey lines shaped like the paragraph that will arrive. Used
 * instead of blank space so the wait has a place to look.
 */
export function LoadingBlock({
  label,
  lines = 3,
  style,
}: {
  /** What is being worked on, shown as the shimmering line. */
  label: string;
  lines?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchment;
  const reduceMotion = useReduceMotion();
  return (
    <View style={[styles.block, style]} testID="loading-block">
      <ShimmerText
        text={label}
        rest={colors.inkSoft}
        lit={colors.accent}
        style={styles.label}
        reduceMotion={reduceMotion}
      />
      <View style={styles.lines}>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton
            key={i}
            width={i === lines - 1 ? "58%" : (LINE_WIDTHS[i % LINE_WIDTHS.length] ?? "100%")}
            height={13}
            radius={6}
            accessibilityLabel={label}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Wraps one section of loaded content so it fades up as it arrives, each 60ms
 * after the one before. Reduce motion shows it as-is.
 */
export function FadeUp({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      style={style}
      entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(fadeUpDelay(index))}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  label: { fontSize: 14, fontWeight: "600" },
  lines: { gap: 10 },
});
