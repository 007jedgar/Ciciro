import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { BLUR_SUPPORTED, glassWashAlpha } from "../lib/blur-support";

/** Semi-transparent variant of a 6-digit hex color. */
export function alpha(hex: string, a: number): string {
  const clamped = Math.max(0, Math.min(1, a));
  return hex + Math.round(clamped * 255).toString(16).padStart(2, "0");
}

/**
 * A frosted, hairline-bordered surface shared by the floating tab bar and the
 * header "new" menu. BlurView only rounds its corners inside an overflow:hidden
 * view, so the shadow lives on the outer view and the blur is clipped separately.
 * Android cannot blur what a floating surface covers (`lib/blur-support.ts`), so
 * there it is the same surface with a near-solid wash.
 */
export function Glass({
  dark,
  colors,
  radius,
  flat = false,
  style,
  children,
}: {
  dark: boolean;
  colors: { panel: string; line: string };
  radius: number;
  /** No drop shadow: for glass inside a scroll view, which would clip the shadow at its edges. */
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <View
      style={[
        !flat && styles.shadow,
        { borderRadius: radius, backgroundColor: alpha(colors.panel, glassWashAlpha(dark ? 0.6 : 0.72)) },
        style,
      ]}
    >
      {BLUR_SUPPORTED ? (
        <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
          <BlurView tint={dark ? "dark" : "light"} intensity={dark ? 32 : 46} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: alpha(colors.line, 0.8) },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
});
