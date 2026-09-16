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

/**
 * Screen options every route that leaves by the pop transition needs.
 *
 * The collapse only reads if the screen being returned to is already on show
 * underneath it, and a pushed card detaches whatever is below — so these routes
 * are presented *over* the stack instead of in place of it. The page colour is
 * left to `StackPopTransition`, which paints it on the view actually being
 * animated; an opaque content background here would sit a level above that and
 * stay full-screen for the whole collapse, hiding the destination.
 *
 * Kept here rather than written out per route: `project/[id]` was pushed as a
 * plain card long after `settings` was fixed, and closing a manuscript played
 * the collapse against nothing.
 */
export const POP_OVER_STACK_SCREEN_OPTIONS = {
  presentation: "transparentModal",
  contentStyle: { backgroundColor: "transparent" },
} as const;

/**
 * The same, for a route in a stack nested inside another one.
 *
 * A plain transparent modal is presented from the react root, so what sits
 * behind it is the window rather than the parent stack's own screens and the
 * collapse plays over bare grey. The contained variant presents over the
 * current context instead, keeping the screen underneath on show
 * (`RNSScreen.mm` maps it to `OverCurrentContext`).
 */
export const CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS = {
  presentation: "containedTransparentModal",
  contentStyle: { backgroundColor: "transparent" },
} as const;

/**
 * Whether the navigator this screen sits in is the one carrying out the
 * removal, rather than an ancestor whose route — and everything nested in it —
 * is on its way out.
 *
 * `beforeRemove` reaches every route nested under the one being removed, and
 * the deepest listeners hear it first. If one of those intercepts, the route
 * that owns the removal never gets its turn: the collapse then plays inside
 * the nested screen, over that screen's own opaque content background instead
 * of over the screen being returned to, and the nested screen re-dispatches
 * the action tagged with its own route key. The target navigator does not
 * know that key, drops the action, and the screen is left collapsed and
 * invisible. Closing a manuscript did exactly this: the tabs inside it
 * intercepted the manuscript's own removal.
 */
export function ownsStackRemove(
  action: { target?: string },
  state: { key: string; index: number } | undefined
): boolean {
  if (!state) return false;
  if (typeof action.target === "string") return action.target === state.key;
  // An untargeted back is taken by the deepest navigator with somewhere to go.
  return state.index > 0;
}
