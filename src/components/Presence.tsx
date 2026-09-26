"use client";

import type { ReactNode } from "react";
import { MOTION_MS, usePresence } from "@/lib/motion";

/**
 * Keeps a drawer or dialog mounted while it plays its exit. The wrapper has no
 * box of its own (display: contents); globals.css animates its `.drawer`,
 * `.outline-panel` and `.drawer-overlay` children from data-state. While it is
 * closing the content is inert, so a second click or a stray focus cannot land
 * on something already leaving.
 */
export default function Presence({
  open,
  exitMs = MOTION_MS.drawerOut,
  children,
}: {
  open: boolean;
  exitMs?: number;
  children: ReactNode;
}) {
  const { mounted, state } = usePresence(open, exitMs);
  if (!mounted) return null;
  return (
    <div className="presence" data-state={state} inert={state === "closed"}>
      {children}
    </div>
  );
}
