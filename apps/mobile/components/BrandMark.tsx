import { Image, type ImageStyle, type StyleProp } from "react-native";

const MARK = require("../assets/mark-warm.png");

/** Terracotta-on-mist ellipsis for parchment screens. */
export function BrandMark({ size = 64, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={MARK}
      // Decorative: the screen around it already says what it is.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      accessibilityIgnoresInvertColors
      style={[{ width: size, height: size, borderRadius: size * 0.22 }, style]}
    />
  );
}
