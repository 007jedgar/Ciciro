/**
 * Keyboard heights, in dp, between which the floating manuscript tab bar tucks away (120 to
 * 200), inlined in the worklet below since a module constant can be missing on the UI
 * runtime. On Android, a floating IME add-on (the system stylus-handwriting toolbar,
 * voice-typing's compact strip) keeps the `ime()` window inset marked visible while
 * occupying far less space than a real keyboard, which pins `keyboard.progress` at 1 with no
 * keyboard actually covering the bar. Driving the hide amount from the measured height keeps
 * the bar shown unless a real keyboard is up.
 *
 * Returns how far the bar should tuck away, from 0 (shown) to 1 (hidden). It ramps
 * continuously between the two thresholds so opening or closing a real keyboard never snaps
 * the bar.
 *
 * Called from `ManuscriptTabBar`'s `useAnimatedStyle` worklet, which runs on the UI thread;
 * an imported function needs its own `"worklet"` directive there, since Reanimated only
 * auto-workletizes the callback passed to a hook, not functions it imports from elsewhere.
 */
export function keyboardHideProgress(keyboardHeight: number): number {
  "worklet";
  const min = 120;
  const full = 200;
  const t = (Math.abs(keyboardHeight) - min) / (full - min);
  return Math.min(1, Math.max(0, t));
}
