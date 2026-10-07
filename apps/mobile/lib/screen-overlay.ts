import { createContext, useContext, type ReactNode } from "react";

/**
 * Lets a component deep inside a pushed screen paint into an untransformed
 * sibling of that screen's `StackPopTransition` wrapper, rather than inside
 * the animated view the push/pop transform is applied to.
 *
 * A screen presented with `transparentModal` (see `POP_OVER_STACK_SCREEN_OPTIONS`)
 * renders above every sibling in the stack natively, so a cross-screen overlay
 * (the shared-title morph) has to live inside the pushed screen's own view tree
 * to be visible at all - but it also has to sit outside the transform that
 * slides/scales that screen in and out, or it would inherit that motion instead
 * of tracking its own source-to-destination path. `StackPopTransition` provides
 * this context once per screen so a descendant can hand it content to render
 * in that untransformed slot, and clear it (`null`) when done.
 */
export const ScreenOverlayContext = createContext<(node: ReactNode | null) => void>(() => {});

export function useSetScreenOverlay(): (node: ReactNode | null) => void {
  return useContext(ScreenOverlayContext);
}
