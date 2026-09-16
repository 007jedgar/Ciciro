import { useCallback } from "react";
import { useNavigationContainerRef, useRouter, type Href } from "expo-router";
import { backPlan, canPop } from "./stack-back";

/**
 * Back actions that still land somewhere when the screen underneath is missing.
 *
 * - `backTo(href)` pops to `href` if it is below the current screen, and swaps
 *   the current screen for it otherwise.
 * - `backOr(href)` pops one screen if there is one to pop to, and swaps the
 *   current screen for `href` otherwise.
 *
 * The root navigation state is read at the moment of the tap rather than
 * subscribed to, so headers using this do not re-render on every navigation.
 */
export function useStackBack() {
  const router = useRouter();
  const container = useNavigationContainerRef();

  const backTo = useCallback(
    (href: Href) => {
      const state = container.isReady() ? container.getRootState() : undefined;
      if (backPlan(state, String(href)) === "pop") router.dismissTo(href);
      else router.replace(href);
    },
    [container, router]
  );

  const backOr = useCallback(
    (href: Href) => {
      const state = container.isReady() ? container.getRootState() : undefined;
      if (canPop(state)) router.back();
      else router.replace(href);
    },
    [container, router]
  );

  return { backTo, backOr };
}
