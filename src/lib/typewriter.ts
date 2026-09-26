/** Below this many pixels of drift the caret is treated as already centered. */
export const TYPEWRITER_DEADBAND = 6;

/**
 * How far to scroll a container so the caret line sits at its vertical center.
 * `caretTop` and `caretBottom` are the caret line's viewport coordinates, and
 * `containerTop` and `containerHeight` describe the scrolling viewport.
 * Returns 0 when the caret is close enough that scrolling would only jitter.
 */
export function typewriterScrollDelta(
  caretTop: number,
  caretBottom: number,
  containerTop: number,
  containerHeight: number
): number {
  const caretMid = (caretTop + caretBottom) / 2;
  const delta = caretMid - (containerTop + containerHeight / 2);
  return Math.abs(delta) < TYPEWRITER_DEADBAND ? 0 : delta;
}
