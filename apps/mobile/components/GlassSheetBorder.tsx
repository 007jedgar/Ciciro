import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, LinearGradient, Path, Skia, vec } from "@shopify/react-native-skia";
import {
  GLASS_SHEET_RADIUS,
  glassSheetFillColors,
  glassSheetRimColors,
  topRoundedPath,
} from "../lib/glass-sheet";

export { GLASS_SHEET_RADIUS, glassSheetFillColors, glassSheetRimColors };

/** A soft top-left sheen, the light a frosted pane catches off the screen. */
function sheenColors(dark: boolean): string[] {
  return dark ? ["#ffffff18", "#ffffff00"] : ["#ffffff40", "#ffffff00"];
}

/**
 * Skia wash + a hairline pane rim. The frost lives in GlassSheet's BlurView;
 * this layer is the glass body and the barely-there edge. The shape is rounded
 * on top and bleeds off the bottom, so the sheet reads as a window rising
 * out of the screen.
 */
export function GlassSheetBorder({
  width,
  height,
  radius = GLASS_SHEET_RADIUS,
  dark,
  base,
}: {
  width: number;
  height: number;
  radius?: number;
  accent?: string;
  dark: boolean;
  base?: string;
  reduceMotion?: boolean;
}) {
  const path = useMemo(
    () => Skia.Path.MakeFromSVGString(topRoundedPath(width, height, radius)),
    [height, radius, width]
  );
  const edge = useMemo(
    () => Skia.Path.MakeFromSVGString(topRoundedPath(width, height, radius - 1, undefined, 1)),
    [height, radius, width]
  );

  if (width < 2 || height < 2 || !path || !edge) return null;

  const fill = glassSheetFillColors(dark, base);
  const rim = glassSheetRimColors(dark);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={path}>
          <LinearGradient start={vec(0, 0)} end={vec(width * 0.35, height)} colors={fill} />
        </Path>
        <Path path={path}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(width * 0.7, height * 0.45)}
            colors={sheenColors(dark)}
          />
        </Path>
        <Path path={edge} style="stroke" strokeWidth={1}>
          <LinearGradient start={vec(0, 0)} end={vec(width, Math.max(48, height * 0.2))} colors={rim} />
        </Path>
      </Canvas>
    </View>
  );
}
