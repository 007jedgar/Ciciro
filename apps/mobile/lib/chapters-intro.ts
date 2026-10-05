/** One tool tile popping in. */
export const TOOL_POP_MS = 260;
/** Gap between one tile starting and the next, so the row fills in left to right. */
export const TOOL_POP_STAGGER_MS = 45;
/** How far left of its place a tile starts, so it drifts right as it pops. */
export const TOOL_POP_DRIFT = 14;

/** How far above its place the chapter list starts when it slides down. */
export const CHAPTERS_SLIDE_DISTANCE = 44;
export const CHAPTERS_SLIDE_MS = 360;
/** Lets the pushed screen finish arriving before its content starts to move. */
export const CHAPTERS_SLIDE_DELAY_MS = 120;

/** When tile `index` starts popping, after `base` ms. */
export function toolPopDelay(index: number, base = 0): number {
  return base + index * TOOL_POP_STAGGER_MS;
}

/** A tile at `progress` (0 hidden, 1 in place): fading up, growing from a bit smaller, drifting in from the left. */
export function toolPopTransform(
  progress: number,
  drift: number
): { opacity: number; scale: number; translateX: number } {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  return { opacity: p, scale: 0.82 + p * 0.18, translateX: (1 - p) * -drift };
}
