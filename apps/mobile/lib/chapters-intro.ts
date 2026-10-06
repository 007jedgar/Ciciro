/** One tool tile popping in. */
export const TOOL_POP_MS = 260;
/** Gap between one tile starting and the next, so the row fills in left to right. */
export const TOOL_POP_STAGGER_MS = 45;
/** How far left of its place a tile starts, so it drifts right as it pops. */
export const TOOL_POP_DRIFT = 14;

/** How far above its place the chapter list starts when it slides down. */
export const CHAPTERS_SLIDE_DISTANCE = 44;
export const CHAPTERS_SLIDE_MS = 360;
/** Counted from the push's start, so the content moves once the screen is well on its way in. */
export const CHAPTERS_SLIDE_DELAY_MS = 120;

/**
 * The chapter list clips its content to the FlatList's own frame, which sits
 * exactly at the screen's padded edge. A header item that scales up on landing
 * (the genre tag's save pulse) needs that frame pulled past the visible edge
 * to have room to overflow into, so the list moves this much padding from the
 * screen into the list's own content container - same resting position, more
 * clip headroom.
 */
export const LIST_EDGE_SLACK = 14;

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
