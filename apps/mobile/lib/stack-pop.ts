export const STACK_POP_MS = 320;
export const STACK_POP_FADE_MS = 140;

/**
 * How far into the pop the leaving screen stays solid. It holds its opacity
 * through the first stretch so the collapse is something you watch happen —
 * fading from the first frame reads as the screen blinking out instead.
 */
export const STACK_POP_FADE_START = 0.55;

/** How much of the viewport the leaving screen crosses on its way to the right edge. */
export const STACK_POP_TRAVEL = 0.26;

export function stackPopTransform(
  progress: number,
  width: number
): {
  opacity: number;
  scale: number;
  translateX: number;
  translateY: number;
  radius: number;
} {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  const fade = p <= STACK_POP_FADE_START ? 0 : (p - STACK_POP_FADE_START) / (1 - STACK_POP_FADE_START);
  return {
    opacity: 1 - fade,
    scale: 1 - p * 0.2,
    translateX: p * width * STACK_POP_TRAVEL,
    // A touch of drop, so it tucks away rather than sliding along a ruler.
    translateY: p * 8,
    // Full-bleed on the way in, a card on the way out.
    radius: p * 24,
  };
}

export function shouldInterceptStackRemove(actionType: string): boolean {
  return (
    actionType === "GO_BACK" ||
    actionType === "POP" ||
    actionType === "POP_TO" ||
    actionType === "POP_TO_TOP"
  );
}
