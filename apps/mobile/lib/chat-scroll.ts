/** Screens above the latest reply before the jump chip starts to appear. */
export const CHAT_JUMP_START_SCREENS = 2;
/** Further screens of travel across which the chip fades from nothing to solid. */
export const CHAT_JUMP_FADE_SCREENS = 1;

/**
 * Opacity of the jump-to-latest chip.
 *
 * It stays invisible until the author is two viewports above the tail, then
 * fades in across the next viewport as they keep scrolling away.
 *
 * `distanceFromTail` is the scroll distance away from the tail position - on
 * an inverted list that is just the raw scroll offset, since offset 0 rests
 * at the tail already.
 */
export function jumpChipOpacity(
  distanceFromTail: number,
  layoutHeight: number,
  startScreens = CHAT_JUMP_START_SCREENS,
  fadeScreens = CHAT_JUMP_FADE_SCREENS
): number {
  if (layoutHeight <= 0) return 0;
  const start = layoutHeight * startScreens;
  if (distanceFromTail <= start) return 0;
  const span = layoutHeight * fadeScreens;
  if (span <= 0) return 1;
  return Math.min(1, (distanceFromTail - start) / span);
}

/**
 * Blank space kept under a prompt that was just sent, so that prompt can sit
 * at the top of the viewport while the reply grows beneath it.
 *
 * Trailing padding is the dock and keyboard inset already applied to the list.
 * The gap shrinks as the prompt is measured, and never goes negative.
 */
export function promptAnchorGap(
  viewportHeight: number,
  promptHeight: number,
  trailingPadding: number
): number {
  if (viewportHeight <= 0) return 0;
  return Math.max(0, viewportHeight - Math.max(0, promptHeight) - Math.max(0, trailingPadding));
}

/**
 * Height of the spacer under the anchored prompt (the inverted thread's list
 * header, so it renders below the newest row) once the reply has left the
 * spacer and taken its own row. While the reply is still streaming inside the
 * spacer, pass 0 so the spacer itself holds the whole gap and growing text
 * does not change the list height.
 */
export function anchorFooterMinHeight(gap: number, replyHeightOutside: number): number {
  return Math.max(0, gap - Math.max(0, replyHeightOutside));
}
