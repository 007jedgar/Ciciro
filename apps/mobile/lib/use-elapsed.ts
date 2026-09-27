import { useEffect, useState } from "react";

/**
 * Milliseconds since `active` last turned on, updated every frame until `capMs`,
 * then held. Zero while inactive. For animating spans of text, which the native
 * driver cannot restyle piece by piece, so their frames are drawn from state.
 */
export function useElapsed(active: boolean, capMs: number): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    let frame: ReturnType<typeof requestAnimationFrame> | null = null;
    const tick = () => {
      const next = Math.min(capMs, Date.now() - start);
      setElapsed(next);
      if (next < capMs) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [active, capMs]);
  return elapsed;
}
