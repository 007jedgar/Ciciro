import { Platform } from "react-native";

/**
 * Whether a `BlurView` really frosts what is behind it. On Android expo-blur
 * blurs only a registered `BlurTargetView`, and a surface that floats over
 * another screen's content (the tab bar, a header, a popup) has none to
 * register, so there the view draws nothing and the glass is only as dense as
 * its wash. Those surfaces skip the blur and use an opaque wash instead, so text
 * scrolling underneath cannot show through (even 0.98 left it legible).
 */
export const BLUR_SUPPORTED = Platform.OS !== "android";

/** The wash alpha for a surface that is blurred where it can be and solid where it cannot. */
export function glassWashAlpha(blurred: number, solid = 1): number {
  return BLUR_SUPPORTED ? blurred : solid;
}
