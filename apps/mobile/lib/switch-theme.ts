import type { SwitchProps } from "react-native";
import type { ColorTokens } from "./theme";

/**
 * Switch colors from the theme, on every platform. iOS and Android paint
 * `thumbColor` in both states; react-native-web only uses it for off and reads
 * `activeThumbColor` for on, which is not in RN's types.
 */
export function switchColors(colors: Pick<ColorTokens, "line" | "accent" | "panel">): SwitchProps {
  return {
    trackColor: { false: colors.line, true: colors.accent },
    thumbColor: colors.panel,
    ...({ activeThumbColor: colors.panel } as object),
  };
}
