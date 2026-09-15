/**
 * The maths behind the sweep that travels along a status label.
 *
 * Kept apart from the component so the shape of the wave can be reasoned about
 * and tested on its own — the renderer only turns a brightness into a colour.
 */

/**
 * Half-width of the lit band, as a fraction of the string. Wide enough that a
 * few characters glow together rather than one blinking at a time.
 */
export const SHIMMER_TAIL = 0.34;

/**
 * Where the crest sits at a given tick, in the same 0..1 space as a character's
 * position. It starts and ends a full tail off each end so the sweep enters
 * from beyond the first character and leaves past the last, instead of igniting
 * and dying on top of them.
 */
export function shimmerHead(clock: number): number {
  "worklet";
  const wrapped = ((clock % 1) + 1) % 1;
  return wrapped * (1 + SHIMMER_TAIL * 2) - SHIMMER_TAIL;
}

/** A character's place along the string, 0 at the first and 1 at the last. */
export function shimmerPosition(index: number, count: number): number {
  "worklet";
  if (count <= 1) return 0;
  return index / (count - 1);
}

/**
 * How lit one character is, 0 (resting) to 1 (at the crest). Falls off as the
 * square of the distance to the crest, which keeps the centre bright and the
 * edges of the band soft rather than banded.
 */
export function shimmerBrightness(clock: number, index: number, count: number): number {
  "worklet";
  const distance = Math.abs(shimmerPosition(index, count) - shimmerHead(clock));
  if (distance >= SHIMMER_TAIL) return 0;
  const closeness = 1 - distance / SHIMMER_TAIL;
  return closeness * closeness;
}
