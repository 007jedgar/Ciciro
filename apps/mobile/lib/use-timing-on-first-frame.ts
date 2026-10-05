import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
  type EasingFunction,
  type EasingFunctionFactory,
  type FrameInfo,
  type SharedValue,
} from "react-native-reanimated";

/**
 * Eases `target` from 0 to `to`, counting only frames that were actually drawn.
 *
 * A screen's first render can keep the main thread busy for a few hundred ms (a
 * chapter list, a project's tabs). A `withTiming` counts that stall as time
 * already played, so the animation reaches the screen part-way or finished and
 * shows as a jump. This advances by the time between frames instead, capped at
 * about two frames' worth, so a stall costs the animation one step and it picks
 * up from where it was.
 *
 * `enabled` false never starts it (reduce motion). It starts on mount, or with
 * `autoStart: false` when the returned `begin` is called, for an animation that
 * should wait until its view has been laid out on screen.
 */
export function useTimingOnFirstFrame(
  target: SharedValue<number>,
  options: { to?: number; duration: number; delay?: number; easing: EasingFunction | EasingFunctionFactory; enabled?: boolean; autoStart?: boolean }
): () => void {
  const { to = 1, duration, delay = 0, easing, enabled = true, autoStart = true } = options;
  const elapsed = useSharedValue(0);
  const frameRef = useRef<{ setActive: (active: boolean) => void } | null>(null);
  const stop = useCallback(() => frameRef.current?.setActive(false), []);
  const ease = useMemo(() => ("factory" in easing ? easing.factory() : easing), [easing]);
  const onFrame = useCallback(
    (info: FrameInfo) => {
      "worklet";
      elapsed.value += Math.min(info.timeSincePreviousFrame ?? 0, 34);
      const t = Math.max(0, Math.min(1, (elapsed.value - delay) / duration));
      target.value = to * ease(t);
      if (t >= 1) runOnJS(stop)();
    },
    [elapsed, target, to, delay, duration, ease, stop]
  );
  const frame = useFrameCallback(onFrame, false);
  frameRef.current = frame;

  const started = useRef(false);
  const begin = useCallback(() => {
    if (!enabled || started.current) return;
    started.current = true;
    frame.setActive(true);
  }, [enabled, frame]);

  // Once, on mount: a screen already open is not started again by a re-render.
  useEffect(() => {
    if (autoStart) begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return begin;
}
