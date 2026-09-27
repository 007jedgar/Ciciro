export function skeletonShineX(progress: number, width: number): number {
  "worklet";
  return -width + progress * width * 2;
}

/** Gap between one section's fade-up and the next when loaded content arrives. */
export const FADE_UP_STAGGER_MS = 60;
/** Only the first few items stagger; a long list should not take seconds to appear. */
const FADE_UP_MAX_STEPS = 8;

/** Delay before item `index` fades up, so a list arrives as a quick cascade. */
export function fadeUpDelay(index: number): number {
  return Math.min(Math.max(index, 0), FADE_UP_MAX_STEPS) * FADE_UP_STAGGER_MS;
}
