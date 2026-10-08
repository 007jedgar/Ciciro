import { useEffect } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { EASE_OUT } from "../../lib/motion";
import { useAppTheme } from "../../lib/settings";

const DOTS = 18;
const BURST_MS = 760;

function Dot({
  progress,
  angle,
  reach,
  size,
  color,
}: {
  progress: SharedValue<number>;
  angle: number;
  reach: number;
  size: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45,
      transform: [
        { translateX: Math.cos(angle) * reach * p },
        // A little fall, so the dots settle instead of hanging in the air.
        { translateY: Math.sin(angle) * reach * p + 26 * p * p },
        { scale: 1 - 0.55 * p },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        { position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

/**
 * A one-shot burst of the paper-stock dots from the middle of the screen, played
 * when an account is created from the onboarding. It runs once, to the end,
 * then calls `onDone`.
 */
export function SuccessBurst({ onDone }: { onDone: () => void }) {
  const { colors } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const palette = [colors.accent, colors.vermilion, colors.butter, colors.blush];

  useEffect(() => {
    progress.value = withTiming(1, { duration: BURST_MS, easing: EASE_OUT }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    // One burst, one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>
      <View style={{ position: "absolute", left: width / 2, top: height * 0.42 }}>
        {Array.from({ length: DOTS }, (_, i) => (
          <Dot
            key={i}
            progress={progress}
            angle={(i / DOTS) * Math.PI * 2 + (i % 2) * 0.17}
            reach={96 + (i % 3) * 38}
            size={6 + (i % 4) * 2}
            color={palette[i % palette.length]!}
          />
        ))}
      </View>
    </View>
  );
}
