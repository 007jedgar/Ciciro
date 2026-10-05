import { createContext, useContext, useEffect } from "react";

/**
 * Fires once, when a pushed screen starts sliding in. A listener added after
 * that runs at once, so content mounted late (a list that waited for its data)
 * still starts, just without waiting.
 */
export type ArrivalSignal = {
  fire: () => void;
  subscribe: (listener: () => void) => () => void;
};

export function createArrivalSignal(fired = false): ArrivalSignal {
  let done = fired;
  const listeners = new Set<() => void>();
  return {
    fire() {
      if (done) return;
      done = true;
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
    subscribe(listener) {
      if (done) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Outside any pushed screen there is no push to wait for. */
export const StackArrivalContext = createContext<ArrivalSignal>(createArrivalSignal(true));

/**
 * Calls `onArrival` once the enclosing pushed screen starts sliding in (at once
 * if it already has, or never had to), so an entrance inside it is timed from
 * the push rather than from its own mount, which can come while the screen is
 * still held offscreen.
 */
export function useStackArrival(onArrival: () => void): void {
  const signal = useContext(StackArrivalContext);
  useEffect(() => signal.subscribe(onArrival), [signal, onArrival]);
}

const restoredHrefs = new Set<string>();
const restoredRouteKeys = new Set<string>();

/**
 * Marks the screens about to be pushed to restore the author's last place, so
 * each arrives already settled instead of sliding in: a restore puts back where
 * they were, it is not a screen they just opened.
 */
export function markRestoredArrivals(hrefs: readonly string[]): void {
  restoredHrefs.clear();
  for (const href of hrefs) restoredHrefs.add(href);
}

function routePath(route: { name: string; params?: object }): string {
  const params = (route.params ?? {}) as Record<string, unknown>;
  const path = route.name.replace(/\[([^\]]+)\]/g, (_, name: string) => String(params[name] ?? ""));
  return `/${path}`;
}

/**
 * Whether this stack route is one a restore pushed. The first route matching a
 * marked href claims it, and keeps the answer for its key, so the same screen
 * opened again later still slides in.
 */
export function arrivesSettled(route: { key: string; name: string; params?: object }): boolean {
  if (restoredRouteKeys.has(route.key)) return true;
  const path = routePath(route);
  for (const href of restoredHrefs) {
    if (href !== path && !href.startsWith(`${path}/`)) continue;
    restoredHrefs.delete(href);
    restoredRouteKeys.add(route.key);
    return true;
  }
  return false;
}
