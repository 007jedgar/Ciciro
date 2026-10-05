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
