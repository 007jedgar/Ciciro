import { useEffect, useRef, useState } from "react";
import {
  WELCOME_KINDS,
  initialFrame,
  settledFrame,
  welcomeSteps,
  type WelcomeCopy,
  type WelcomeFrame,
  type WelcomeStep,
} from "./welcome-script";

/** Under Reduce motion the page holds one kind this long, then swaps to the next. */
export const WELCOME_SWAP_MS = 3600;

/**
 * Plays `welcomeSteps` as frames: one timer per frame, and none while `play` is
 * false (the screen is not on show, or the app is in the background), resuming
 * exactly where it stopped. A new `copy` (the language changed) starts over.
 *
 * With `reduceMotion` nothing types: the page shows a finished kind and the
 * `kind` it is on changes by itself every `WELCOME_SWAP_MS` (the screen
 * crossfades between them), again only while `play`.
 */
export function useWelcomeFrame(
  copy: WelcomeCopy,
  { play, reduceMotion }: { play: boolean; reduceMotion: boolean }
): { frame: WelcomeFrame; swapping: boolean } {
  const [frame, setFrame] = useState<WelcomeFrame>(() => (reduceMotion ? settledFrame(copy, WELCOME_KINDS[0]) : initialFrame(copy)));
  const [swapping, setSwapping] = useState(false);
  const generator = useRef<Generator<WelcomeStep, never, undefined> | null>(null);
  const pending = useRef<WelcomeStep | null>(null);
  const kindIndex = useRef(0);

  // A new language or motion setting: the page starts over.
  useEffect(() => {
    generator.current = null;
    pending.current = null;
    kindIndex.current = 0;
    setSwapping(false);
    setFrame(reduceMotion ? settledFrame(copy, WELCOME_KINDS[0]) : initialFrame(copy));
  }, [copy, reduceMotion]);

  useEffect(() => {
    if (!play || reduceMotion) return;
    const gen = (generator.current ??= welcomeSteps(copy));
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const step = (pending.current ??= gen.next().value);
      timer = setTimeout(() => {
        pending.current = null;
        setFrame(step.frame);
        next();
      }, step.wait);
    };
    next();
    return () => clearTimeout(timer);
  }, [play, reduceMotion, copy]);

  useEffect(() => {
    if (!play || !reduceMotion) return;
    let swap: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => {
      setSwapping(true);
      swap = setTimeout(() => {
        kindIndex.current = (kindIndex.current + 1) % WELCOME_KINDS.length;
        setFrame(settledFrame(copy, WELCOME_KINDS[kindIndex.current]));
        setSwapping(false);
      }, 160);
    }, WELCOME_SWAP_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(swap);
    };
  }, [play, reduceMotion, copy, frame]);

  return { frame, swapping };
}
