/** Screens above the latest reply before the jump chip starts to appear. */
export const CHAT_JUMP_START_SCREENS = 2;
/** Further screens of travel across which the chip fades from nothing to solid. */
export const CHAT_JUMP_FADE_SCREENS = 1;

/**
 * Opacity of the jump-to-latest chip.
 *
 * It stays invisible until the author is two viewports above the tail, then
 * fades in across the next viewport as they keep scrolling away.
 */
export function jumpChipOpacity(
  contentHeight: number,
  layoutHeight: number,
  offsetY: number,
  startScreens = CHAT_JUMP_START_SCREENS,
  fadeScreens = CHAT_JUMP_FADE_SCREENS
): number {
  if (layoutHeight <= 0) return 0;
  const distance = contentHeight - layoutHeight - offsetY;
  const start = layoutHeight * startScreens;
  if (distance <= start) return 0;
  const span = layoutHeight * fadeScreens;
  if (span <= 0) return 1;
  return Math.min(1, (distance - start) / span);
}
