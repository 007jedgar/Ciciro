/**
 * Going back to a screen that may or may not be there.
 *
 * A screen is not always reached the way the stack assumes. The app restores
 * the last manuscript straight from the welcome route, and the sign-in screen
 * is where every screen redirects to once the session is gone — so the screen
 * "underneath" can be missing altogether. Popping then has nothing to reveal.
 *
 * `backPlan` decides between the two: pop to the screen when it is already
 * below the current one, and swap the current screen for it when it is not.
 * The swap is a replace rather than a push so the screen being left does not
 * stay in the stack under the one it was trying to get back to.
 */

export type BackPlan = "pop" | "replace";

/** The part of a navigation state this reads; a not-yet-rehydrated state may have no index. */
export type StackState = {
  index?: number;
  routes: ReadonlyArray<{ name: string; state?: StackState }>;
};

function focusedIndex(state: StackState): number {
  return state.index ?? state.routes.length - 1;
}

/**
 * The state of the app's own root stack.
 *
 * What the navigation container reports as its root is expo-router's wrapper
 * navigator: one route named `__root`, holding the stack the root layout
 * renders. Read from the wrapper, every stack looks one screen deep and back
 * never has anywhere to go.
 */
export function appStackState(root: StackState | undefined): StackState | undefined {
  let state = root;
  while (state) {
    const focused = state.routes[focusedIndex(state)];
    if (focused?.name !== "__root" || !focused.state) return state;
    state = focused.state;
  }
  return state;
}

/** The root-stack route name an href lands on. */
export function rootRouteName(href: string): string {
  const [first = ""] = href.replace(/^\/+/, "").split(/[/?#]/);
  if (first === "") return "index";
  if (first === "project" || first === "folder") return `${first}/[id]`;
  return first;
}

/**
 * Whether `href` is already on the root stack below the current screen, so a
 * pop can land on it.
 */
export function hasScreenBelow(root: StackState | undefined, href: string): boolean {
  const state = appStackState(root);
  if (!state) return false;
  const name = rootRouteName(href);
  return state.routes.slice(0, focusedIndex(state)).some((route) => route.name === name);
}

export function backPlan(root: StackState | undefined, href: string): BackPlan {
  return hasScreenBelow(root, href) ? "pop" : "replace";
}

/** Whether there is any screen below the current one to pop to. */
export function canPop(root: StackState | undefined): boolean {
  const state = appStackState(root);
  return state ? focusedIndex(state) > 0 : false;
}
