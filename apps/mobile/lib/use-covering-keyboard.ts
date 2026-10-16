import { Platform } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { isRealKeyboard } from "./manuscript-tab-bar";

/**
 * Whether a keyboard is covering the bottom of the screen. On Android a floating IME add-on
 * (voice typing's strip, the handwriting toolbar) reports `isVisible` while covering nothing,
 * so a screen that drops its bottom inset or lifts a bar for "the keyboard" would sink under
 * the system gesture bar or the tab bar; only a real keyboard counts there (`isRealKeyboard`).
 */
export function useCoveringKeyboard(): boolean {
  return useKeyboardState(
    (state) => state.isVisible && (Platform.OS !== "android" || isRealKeyboard(state.height))
  );
}
