/**
 * Minimum keyboard height, in dp, before the floating manuscript tab bar tucks away. On
 * Android, a floating IME add-on (the system stylus-handwriting toolbar, voice-typing's
 * compact strip) keeps the `ime()` window inset marked visible while occupying far less
 * space than a real keyboard, which pins `keyboard.progress` at 1 with no keyboard actually
 * covering the bar. Gating on the measured height as well keeps the bar shown unless a real
 * keyboard is up.
 */
export const MIN_KEYBOARD_HEIGHT_TO_HIDE_TAB_BAR = 120;

/**
 * Whether the keyboard is tall enough to actually cover the floating tab bar.
 *
 * Called from `ManuscriptTabBar`'s `useAnimatedStyle` worklet, which runs on the UI thread;
 * an imported function needs its own `"worklet"` directive there, since Reanimated only
 * auto-workletizes the callback passed to a hook, not functions it imports from elsewhere.
 */
export function keyboardCoversTabBar(keyboardHeight: number): boolean {
  "worklet";
  return Math.abs(keyboardHeight) > MIN_KEYBOARD_HEIGHT_TO_HIDE_TAB_BAR;
}
