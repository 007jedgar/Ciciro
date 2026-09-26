"use client";

import { useEffect, useState } from "react";
import { MOTION_MS, afterPaint, motionMs } from "@/lib/motion";

/**
 * Focus mode is not a switch but a short handover, so the chrome can fade
 * instead of vanishing:
 *  - entering: the chrome is still laid out, fading and sliding away
 *  - on:       the chrome is gone and the page owns the window
 *  - leaving:  the chrome is laid out again but still hidden, for one paint,
 *              so it has something to fade in from
 *  - off:      the normal workspace
 */
export type FocusPhase = "off" | "entering" | "on" | "leaving";

export function useFocusPhase(active: boolean): FocusPhase {
  const [phase, setPhase] = useState<FocusPhase>(active ? "on" : "off");
  useEffect(() => {
    if (active) {
      const wait = motionMs(MOTION_MS.focus);
      if (wait === 0) {
        setPhase("on");
        return;
      }
      setPhase((now) => (now === "on" ? now : "entering"));
      const timer = setTimeout(() => setPhase("on"), wait);
      return () => clearTimeout(timer);
    }
    if (motionMs(MOTION_MS.focus) === 0) {
      setPhase("off");
      return;
    }
    setPhase((now) => (now === "off" ? now : "leaving"));
    return afterPaint(() => setPhase("off"));
  }, [active]);
  return phase;
}
