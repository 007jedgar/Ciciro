import { useCallback } from "react";
import { useNavigationContainerRef, useRouter, type Href } from "expo-router";
import { appStackState, backPlan, canPop, rootRouteName } from "./stack-back";

/**
 * Back actions that still land somewhere when the screen underneath is missing.
 *
 * - `backTo(href)` pops to `href` if it is below the current screen, and swaps
 *   the current screen for it otherwise.
 * - `backOr(href)` pops one screen if there is one to pop to, and swaps the
 *   current screen for `href` otherwise.
 * - `resetTo(href)` replaces the whole root stack with just `href` in one
 *   dispatch. Unlike `backTo`, it does not need `href` to already be in the
 *   stack: a signed-in session has already replaced the welcome screen out
 *   of it (`restoreLastPlace`), so `backTo("/")` would just find nothing to
 *   pop to and fall back to an in-place replace, leaving the screens it was
 *   meant to leave mounted underneath as modals. A `dismissAll()` then
 *   `replace()` has the same problem one layer down: `dismissAll` dispatches
 *   `POP_TO_TOP`, which `StackPopTransition`'s `beforeRemove` intercepts to
 *   play its collapse animation, `preventDefault`-ing the real removal until
 *   the animation finishes - so the `replace` right after it still runs
 *   against the old, un-popped state, replacing only the focused modal
 *   screen and leaving the rest mounted underneath (`RESET` isn't one of the
 *   action types that animation intercepts, so this skips it instead of
 *   racing it). Use this for "leave the signed-in app entirely" (sign-out,
 *   account deletion), not for an ordinary header back button.
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

  const resetTo = useCallback(
    (href: Href) => {
      const root = container.isReady() ? container.getRootState() : undefined;
      const target = appStackState(root)?.key;
      container.dispatch({
        type: "RESET",
        payload: { index: 0, routes: [{ name: rootRouteName(String(href)) }] },
        target,
      });
    },
    [container]
  );

  return { backTo, backOr, resetTo };
}
