import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { alpha } from "./Glass";

/**
 * Blur layers from weakest to strongest. Each one is masked to fade out a
 * little higher than the last, so the blur radius climbs toward the top edge
 * instead of the whole band sharing one strength.
 */
const LAYERS = [
  { intensity: 10, solidUntil: 0.55 },
  { intensity: 22, solidUntil: 0.35 },
  { intensity: 40, solidUntil: 0.15 },
] as const;

/**
 * A blur that is strongest at the top and melts away at the bottom, with a
 * light wash of `color` so text on top stays readable while what scrolls
 * underneath still shows through.
 */
export function ProgressiveBlur({
  dark,
  color,
  style,
}: {
  dark: boolean;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {LAYERS.map(({ intensity, solidUntil }) => (
        <MaskedView
          key={intensity}
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={["#000", "#000", "transparent"]}
              locations={[0, solidUntil, Math.min(1, solidUntil + 0.45)]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView
            tint={dark ? "dark" : "light"}
            intensity={intensity}
            blurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      ))}
      <LinearGradient
        colors={[alpha(color, dark ? 0.72 : 0.66), alpha(color, 0.4), alpha(color, 0)]}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
