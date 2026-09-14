import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import {
  Blur,
  Canvas,
  Group,
  LinearGradient,
  Paint,
  Path,
  Skia,
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
  topRoundedPath,
} from "../lib/glass-sheet";

export { GLASS_SHEET_RADIUS, glassSheetFillColors, glassSheetGlowColors };

export const GLASS_SHEET_GLOW_MS = 7_200;

/** A soft top-left sheen, the light a frosted pane catches off the screen. */
function sheenColors(dark: boolean): string[] {
  return dark ? ["#ffffff1f", "#ffffff00"] : ["#ffffff59", "#ffffff00"];
}

/**
 * Skia wash + hue-shifting glow stroke. The frost lives in GlassSheet's BlurView;
 * this layer is the material and the living edge. The shape is rounded on top and
 * bleeds off the bottom of the canvas, so the sheet reads as rising out of the screen.
 */
export function GlassSheetBorder({
  width,
  height,
  radius = GLASS_SHEET_RADIUS,
  accent,
  dark,
  base,
  reduceMotion,
}: {
  width: number;
  height: number;
  radius?: number;
  accent: string;
  dark: boolean;
  base?: string;
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

  const path = useMemo(
    () => Skia.Path.MakeFromSVGString(topRoundedPath(width, height, radius)),
    [height, radius, width]
  );
  // The glow is stroked on its own centre line, one pixel in, so the full bead
  // stays on canvas instead of being halved by the screen edge.
  const edge = useMemo(
    () => Skia.Path.MakeFromSVGString(topRoundedPath(width, height, radius - 1, undefined, 1)),
    [height, radius, width]
  );

  if (width < 2 || height < 2 || !path || !edge) return null;

  const center = vec(width / 2, height / 2);
  const glow = glassSheetGlowColors(accent);
  const fill = glassSheetFillColors(dark, base);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={path}>
          <LinearGradient start={vec(0, 0)} end={vec(width * 0.35, height)} colors={fill} />
        </Path>
        <Path path={path}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(width * 0.75, height * 0.7)}
            colors={sheenColors(dark)}
          />
        </Path>
        <Group
          layer={
            <Paint>
              <Blur blur={10} />
            </Paint>
          }
        >
          <Path path={edge} style="stroke" strokeWidth={7} opacity={0.62}>
            <SweepGradient c={center} colors={glow} start={start} end={end} />
          </Path>
        </Group>
        <Path path={edge} style="stroke" strokeWidth={1.6}>
          <SweepGradient c={center} colors={glow} start={start} end={end} />
        </Path>
      </Canvas>
    </View>
  );
}
