"use client";

import { useEffect, useState } from "react";
import { MOTION_MS, prefersReducedMotion } from "@/lib/motion";

type Step = { text: string; typing: boolean; delay: number };

/**
 * One keystroke of the cycle: from showing `text` of `words[index]`, what to
 * show next and how long to wait before the keystroke after it. A word rests,
 * is erased a key at a time, and the next is typed in.
 */
export function nextStep(
  words: readonly string[],
  index: number,
  text: string,
  erasing: boolean
): { index: number; erasing: boolean; step: Step } {
  if (erasing && text.length > 0) {
    return { index, erasing, step: { text: text.slice(0, -1), typing: true, delay: MOTION_MS.keyErase } };
  }
  if (erasing) {
    const next = (index + 1) % words.length;
    const step = { text: words[next].slice(0, 1), typing: true, delay: MOTION_MS.keyType * 3 };
    return { index: next, erasing: false, step };
  }
  const word = words[index];
  if (text.length < word.length) {
    return { index, erasing, step: { text: word.slice(0, text.length + 1), typing: true, delay: MOTION_MS.keyType } };
  }
  return { index, erasing: true, step: { text, typing: false, delay: MOTION_MS.wordHold } };
}

/**
 * The headline's subject, erased and retyped every couple of seconds. Every
 * word sits in the same grid cell, invisible, so the slot is always as wide as
 * the longest and the headline never reflows. Screen readers get the sentence
 * from the heading's own text instead (this is aria-hidden). With motion
 * reduced it stays on the first word, and it pauses while the tab is hidden.
 */
export default function CyclingWord({ words }: { words: readonly string[] }) {
  const [text, setText] = useState(words[0]);
  const [typing, setTyping] = useState(false);
  const [still, setStill] = useState(true);

  useEffect(() => {
    if (words.length < 2) return;
    let index = 0;
    let current = words[0];
    let erasing = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const rest = () => {
      stop();
      index = 0;
      current = words[0];
      erasing = true;
      setText(current);
      setTyping(false);
      setStill(true);
    };
    const schedule = (delay: number) => {
      stop();
      timer = setTimeout(tick, delay);
    };
    function tick() {
      if (prefersReducedMotion()) return rest();
      const next = nextStep(words, index, current, erasing);
      index = next.index;
      erasing = next.erasing;
      current = next.step.text;
      setText(current);
      setTyping(next.step.typing);
      schedule(next.step.delay);
    }
    const start = () => {
      if (document.hidden || prefersReducedMotion()) return;
      setStill(false);
      schedule(MOTION_MS.wordHold);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => (prefersReducedMotion() ? rest() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
    };
  }, [words]);

  return (
    <span className="landing-cycle" aria-hidden data-still={still ? "true" : undefined}>
      {words.map((word) => (
        <span key={word} className="landing-cycle-ghost">
          {word}
        </span>
      ))}
      <span className="landing-cycle-word">
        {text}
        <span className={`landing-caret landing-cycle-caret${typing ? " typing" : ""}`} />
      </span>
    </span>
  );
}
