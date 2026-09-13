import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import {
  Blur,
  Canvas,
  Group,
  LinearGradient,
  Paint,
  RoundedRect,
  SweepGradient,
  vec,
} from "@shopify/react-native-skia";
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  GLASS_SHEET_RADIUS,
  glassSheetFillColors,
  glassSheetGlowColors,
} from "../lib/glass-sheet";

export { GLASS_SHEET_RADIUS, glassSheetFillColors, glassSheetGlowColors };

export const GLASS_SHEET_GLOW_MS = 7_200;

/**
 * Skia wash + hue-shifting glow stroke. The frost lives in GlassSheet's BlurView;
 * this layer is the material and the living edge.
 */
export function GlassSheetBorder({
  width,
  height,
  radius = GLASS_SHEET_RADIUS,
  accent,
  dark,
  reduceMotion,
}: {
  width: number;
  height: number;
  radius?: number;
  accent: string;
  dark: boolean;
  reduceMotion: boolean;
}) {
  const hue = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(hue);
      hue.value = 0;
      return;
    }
    hue.value = 0;
    hue.value = withRepeat(
      withTiming(Math.PI * 2, { duration: GLASS_SHEET_GLOW_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(hue);
  }, [hue, reduceMotion]);

  const start = useDerivedValue(() => hue.value);
  const end = useDerivedValue(() => hue.value + Math.PI * 2);

  if (width < 2 || height < 2) return null;

  const inset = 1.25;
  const innerW = width - inset * 2;
  const innerH = height - inset * 2;
  const center = vec(width / 2, height / 2);
  const glow = glassSheetGlowColors(accent);
  const fill = glassSheetFillColors(dark);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <RoundedRect x={inset} y={inset} width={innerW} height={innerH} r={radius - 1}>
          <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={fill} />
        </RoundedRect>
        <Group
          layer={
            <Paint>
              <Blur blur={10} />
            </Paint>
          }
        >
          <RoundedRect
            x={inset}
            y={inset}
            width={innerW}
            height={innerH}
            r={radius - 1}
            style="stroke"
            strokeWidth={7}
            opacity={0.62}
          >
            <SweepGradient c={center} colors={glow} start={start} end={end} />
          </RoundedRect>
        </Group>
        <RoundedRect
          x={inset}
          y={inset}
          width={innerW}
          height={innerH}
          r={radius - 1}
          style="stroke"
          strokeWidth={1.6}
        >
          <SweepGradient c={center} colors={glow} start={start} end={end} />
        </RoundedRect>
      </Canvas>
    </View>
  );
}
