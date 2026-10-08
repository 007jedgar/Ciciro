import { AccessibilityInfo } from "react-native";

/**
 * Speaks a status line to VoiceOver. iOS does not read a message that appears
 * on screen (an error, a snackbar, a search count) unless it is announced, and
 * `accessibilityRole="alert"` / `accessibilityLiveRegion` only work on Android.
 * Quiet when no screen reader is running.
 */
export function announce(message: string | null | undefined): void {
  const text = message?.trim();
  if (text) AccessibilityInfo.announceForAccessibility(text);
}
