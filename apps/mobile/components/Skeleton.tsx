import { useEffect, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useOptionalAppTheme } from "../lib/settings";
import { skeletonShineX } from "../lib/skeleton";
import { colors as parchment } from "../lib/theme";
import { alpha } from "./Glass";

const SHIMMER_MS = 1_350;

export function Skeleton({
  width = "100%",
  height = 14,
  radius = 8,
  style,
  accessibilityLabel = "Loading",
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const theme = useOptionalAppTheme();
  const osReduce = useReducedMotion();
  const reduceMotion = Boolean(theme?.settings.reduceMotion || osReduce);
  const colors = theme?.colors ?? parchment;
  const progress = useSharedValue(0);
  const trackWidth = typeof width === "number" ? width : 220;

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: SHIMMER_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      false
    );
  }, [progress, reduceMotion]);

  const shine = useAnimatedStyle(() => ({
    transform: [{ translateX: skeletonShineX(progress.value, trackWidth) }],
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.55, 0]),
  }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          width,
          height,
          borderRadius: radius,
          overflow: "hidden",
          backgroundColor: colors.panel2,
        },
        style,
      ]}
    >
      {reduceMotion ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { width: Math.min(trackWidth * 0.45, 96), backgroundColor: alpha(colors.panel, 0.9) },
            shine,
          ]}
        />
      )}
    </View>
  );
}

/** Placeholder that matches a manuscript/folder/chapter card. */
export function SkeletonCard({ accessibilityLabel = "Loading" }: { accessibilityLabel?: string }) {
  const theme = useOptionalAppTheme();
  const colors = theme?.colors ?? parchment;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={{
        backgroundColor: colors.panel,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: 10,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <Skeleton width="72%" height={18} radius={7} accessibilityLabel={accessibilityLabel} />
      <Skeleton width="48%" height={13} radius={6} style={{ marginTop: 10 }} accessibilityLabel={accessibilityLabel} />
    </View>
  );
}

export function SkeletonList({
  count = 5,
  accessibilityLabel = "Loading",
}: {
  count?: number;
  accessibilityLabel?: string;
}) {
  const rows: ReactNode[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(<SkeletonCard key={i} accessibilityLabel={accessibilityLabel} />);
  }
  return <View>{rows}</View>;
}
