"use client";

import { useRef, type ReactNode } from "react";
import { MOTION_MS, usePresence } from "@/lib/motion";

/**
 * An accordion body: grows open (height and fade) and folds shut, keeping what
 * it last showed on screen while it folds so it does not empty out first.
 */
export default function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const { mounted, state } = usePresence(open, MOTION_MS.accordion);
  const last = useRef(children);
  if (open) last.current = children;
  if (!mounted) return null;
  return (
    <div className="collapse" data-state={state} inert={state === "closed"}>
      <div className="collapse-inner">{open ? children : last.current}</div>
    </div>
  );
}
