import { Image, type ImageStyle, type StyleProp } from "react-native";

const MARK = require("../assets/mark-warm.png");

/** Terracotta-on-mist ellipsis for parchment screens. */
export function BrandMark({ size = 64, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={MARK}
      accessibilityIgnoresInvertColors
      style={[{ width: size, height: size, borderRadius: size * 0.22 }, style]}
    />
  );
}
