"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Durations that JS has to wait out (unmounting after an exit, removing a row
// after it slid away). They mirror the --duration-* tokens in globals.css;
// test/motion.test.ts fails when the two drift.
export const MOTION_MS = {
  drawerOut: 180,
  dialogOut: 180,
  popoverOut: 100,
  remove: 200,
  collapse: 180,
  accordion: 200,
  flash: 400,
  pulse: 700,
  focus: 250,
  reorder: 150,
  drop: 120,
  typewriter: 120,
  suggestionCollapse: 160,
} as const;

/** The writer's reduce-motion setting, or the OS one. */
export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.getAttribute("data-reduce-motion") === "true") return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** `ms`, or 0 when motion is reduced. */
export function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

export type PresenceState = "open" | "closed";

/**
 * Keep something mounted while it animates out. `mounted` is true from the
 * moment `open` turns true until `exitMs` after it turns false; `state` is the
 * value to put on the element's data-state so CSS can play the enter or exit.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);
  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const wait = motionMs(exitMs);
    if (wait === 0) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), wait);
    return () => clearTimeout(timer);
  }, [open, exitMs]);
  return { mounted: open || mounted, state: open ? "open" : "closed" };
}

/**
 * Run `work` once the browser has painted `start`, so a transition from it
 * has something to start from. Returns a canceller.
 */
export function afterPaint(work: () => void): () => void {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(work);
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/**
 * Record a row's height in --row-h so its exit can collapse from that height
 * to zero (CSS cannot animate to or from `auto`). Rows opt in with data-row-id.
 */
export function measureRow(id: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
  if (el) el.style.setProperty("--row-h", `${el.offsetHeight}px`);
}

/**
 * Remove-then-undo bookkeeping for a list: `leaving` ids play their exit,
 * `hidden` ids are gone from view but not yet deleted for real.
 */
export function useLeavingIds() {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const t of live) clearTimeout(t);
    };
  }, []);

  const update = (set: ReadonlySet<string>, id: string, add: boolean) => {
    const next = new Set(set);
    if (add) next.add(id);
    else next.delete(id);
    return next;
  };

  /** Slide `id` out, then hide it. Resolves once it is hidden. */
  const leave = useCallback((id: string) => {
    return new Promise<void>((resolve) => {
      const finish = () => {
        setLeaving((s) => update(s, id, false));
        setHidden((s) => update(s, id, true));
        resolve();
      };
      const wait = motionMs(MOTION_MS.remove);
      if (wait === 0) return finish();
      measureRow(id);
      setLeaving((s) => update(s, id, true));
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        finish();
      }, wait);
      timers.current.add(timer);
    });
  }, []);

  /** Bring `id` back (Undo). */
  const restore = useCallback((id: string) => {
    setLeaving((s) => update(s, id, false));
    setHidden((s) => update(s, id, false));
  }, []);

  /** Forget `id` once it is gone for real. */
  const forget = useCallback((id: string) => {
    setHidden((s) => update(s, id, false));
  }, []);

  return { leaving, hidden, leave, restore, forget };
}
