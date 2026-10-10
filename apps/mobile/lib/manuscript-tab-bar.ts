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

/** The selected-tab bubble's frame at a (possibly fractional) tab position. */
export type TabBubble = {
  left: number;
  width: number;
  /** Corner radius of the bubble's left and right ends. */
  leftRadius: number;
  rightRadius: number;
};

/**
 * Geometry of the bubble behind the selected tab, for `position` (0 for the first tab, up to
 * `count - 1` for the last; fractional while it slides). `seg` is one tab's width, `pad` how
 * far the pill's padding reaches past the tab row on each side, `height` the pill's height,
 * `inset` the gap between the bubble and the pill's edge, and `gap` the gap between the bubble
 * and its neighbouring tab.
 *
 * The bubble fills its segment of the pill. At the two ends its outer edge sits `inset` inside
 * the pill and follows the pill's own curve (a concentric radius); everywhere else it is a
 * rounded rectangle with the flatter `midRadius`. Edges and radii interpolate between tab
 * positions, so the shape morphs as it slides: oval at the ends, flattening toward the middle.
 *
 * Called from `ManuscriptTabBar`'s `useAnimatedStyle` worklet on the UI thread, hence the
 * `"worklet"` directive (see `keyboardHideProgress`); it inlines every number it needs.
 */
export function tabBubble(
  position: number,
  count: number,
  seg: number,
  pad: number,
  height: number,
  inset: number,
  gap: number,
  midRadius: number
): TabBubble {
  "worklet";
  if (seg <= 0) return { left: 0, width: 0, leftRadius: 0, rightRadius: 0 };
  const lastIndex = count - 1;
  const clamped = Math.min(lastIndex, Math.max(0, position));
  const lower = Math.floor(clamped);
  const upper = Math.min(lastIndex, lower + 1);
  const frac = clamped - lower;
  const outer = height / 2 - inset;
  const edge = (index: number) => {
    const left = index * seg + (index === 0 ? inset - pad : gap / 2);
    const right = (index + 1) * seg - (index === lastIndex ? inset - pad : gap / 2);
    return { left, right };
  };
  const from = edge(lower);
  const to = edge(upper);
  // Clamped to the first and last tab, so the bubble never leaves the pill.
  const left = from.left + (to.left - from.left) * frac;
  const right = from.right + (to.right - from.right) * frac;
  const radiusAt = (index: number, side: "left" | "right") =>
    (side === "left" ? index === 0 : index === lastIndex) ? outer : midRadius;
  return {
    left,
    width: right - left,
    leftRadius: radiusAt(lower, "left") + (radiusAt(upper, "left") - radiusAt(lower, "left")) * frac,
    rightRadius: radiusAt(lower, "right") + (radiusAt(upper, "right") - radiusAt(lower, "right")) * frac,
  };
}
