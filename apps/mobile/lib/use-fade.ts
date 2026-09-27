import { useEffect, useRef, useState } from "react";

/**
 * A value that eases to `target` (0 or 1) over `ms` whenever the target changes,
 * for styling text spans, which the native driver cannot animate. It moves from
 * wherever it currently is, so a quick flip does not jump. `enabled: false`
 * (reduce motion) makes it instant.
 */
export function useFade(target: 0 | 1, ms: number, enabled = true): number {
  const [value, setValue] = useState<number>(target);
  const current = useRef<number>(target);

  useEffect(() => {
    if (!enabled || ms <= 0) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    if (from === target) return;
    const start = Date.now();
    let frame: ReturnType<typeof requestAnimationFrame> | null = null;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      const next = from + (target - from) * t;
      current.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [target, ms, enabled]);

  return value;
}
