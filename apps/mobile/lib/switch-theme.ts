import { Platform, type SwitchProps } from "react-native";
import type { ColorTokens } from "./theme";

/** Relative lightness of a 6-digit hex color, 0 (black) to 1 (white). */
function lightness(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  if (Number.isNaN(n)) return 1;
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/**
 * Switch colors from the theme, on every platform. iOS and Android paint
 * `thumbColor` in both states; react-native-web only uses it for off and reads
 * `activeThumbColor` for on, which is not in RN's types.
 *
 * On a dark theme the panel color is nearly black, which on Android left the thumb
 * invisible against the off track and dark on the accent track. There the thumb is the
 * theme's text color instead (light on dark), which reads against both.
 */
export function switchColors(
  colors: Pick<ColorTokens, "line" | "accent" | "panel"> & Partial<Pick<ColorTokens, "ink">>
): SwitchProps {
  const thumb = Platform.OS === "android" && colors.ink && lightness(colors.panel) < 0.4 ? colors.ink : colors.panel;
  return {
    trackColor: { false: colors.line, true: colors.accent },
    thumbColor: thumb,
    ...({ activeThumbColor: thumb } as object),
  };
}
