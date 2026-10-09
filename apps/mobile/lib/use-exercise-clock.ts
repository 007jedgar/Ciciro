import { useEffect, useRef, useState } from "react";
import { Easing, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { fractionOf } from "./writing-exercise";
import { useReduceMotion } from "./use-reduce-motion";

/** The ring eases between the clock's quarter-second ticks, so it moves as one line and not in steps. */
const RING_EASE_MS = 260;
const TICK_MS = 250;

/**
 * A soft clock over `totalMs`: the wall time since `active` turned on (so it
 * keeps true through a backgrounded app), a 0 to 1 `progress` for a
 * `ProgressRing`, and `done` once the span has run. It never stops anything:
 * past the end `elapsedMs` is held at the total, and `onDone` fires once.
 */
export function useExerciseClock(
  active: boolean,
  totalMs: number,
  onDone?: () => void
): { progress: SharedValue<number>; elapsedMs: number; done: boolean } {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    progress.value = 0;
    setElapsedMs(0);
    if (!active) return;
    const startedAt = Date.now();
    let finished = false;
    const tick = () => {
      const elapsed = Math.min(totalMs, Date.now() - startedAt);
      setElapsedMs(elapsed);
      const fraction = fractionOf(elapsed, totalMs);
      progress.value = reduceMotion ? fraction : withTiming(fraction, { duration: RING_EASE_MS, easing: Easing.linear });
      if (elapsed >= totalMs && !finished) {
        finished = true;
        clearInterval(timer);
        onDoneRef.current?.();
      }
    };
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [active, totalMs, reduceMotion, progress]);

  return { progress, elapsedMs, done: active && elapsedMs >= totalMs };
}
