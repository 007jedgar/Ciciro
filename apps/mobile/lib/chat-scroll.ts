/** How far above the tail before the jump-to-latest chip appears. */
export const CHAT_JUMP_THRESHOLD = 160;

/** True when the author has scrolled far enough off the latest reply. */
export function isScrolledFromBottom(
  contentHeight: number,
  layoutHeight: number,
  offsetY: number,
  threshold = CHAT_JUMP_THRESHOLD
): boolean {
  return contentHeight - layoutHeight - offsetY > threshold;
}
