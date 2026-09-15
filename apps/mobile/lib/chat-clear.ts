/**
 * The shape of clearing a conversation.
 *
 * Clearing is a small ceremony rather than a blank: the thread collapses into
 * the Ciciro mark, the mark takes the hit, and an Undo stays within reach for a
 * few seconds afterwards. The timings and the phase transitions live here as
 * plain data so the sequence can be reasoned about without a device.
 */

export type ClearPhase =
  /** Nothing happening. */
  | "idle"
  /** The thread is collapsing toward the mark. */
  | "collapsing"
  /** The thread is gone; the mark is taking the hit. */
  | "absorbed"
  /** Cleared, with Undo still on offer. */
  | "offered";

export const CLEAR_TIMING = {
  /** How long the thread takes to fall into the mark. */
  collapseMs: 440,
  /** When the mark reacts — just before the thread finishes arriving. */
  hopAtMs: 340,
  /** Beat on the empty page before the Undo appears. */
  settleMs: 220,
  /** How long Undo stays on offer. */
  offerMs: 6_000,
} as const;

/** The steps of the ceremony, each with the delay from the start of the clear. */
export function clearSchedule(): { at: number; phase: ClearPhase }[] {
  const { collapseMs, settleMs, offerMs } = CLEAR_TIMING;
  return [
    { at: 0, phase: "collapsing" },
    { at: collapseMs, phase: "absorbed" },
    { at: collapseMs + settleMs, phase: "offered" },
    { at: collapseMs + settleMs + offerMs, phase: "idle" },
  ];
}

/** True while the thread should still be drawn, collapsing or not. */
export function showsThread(phase: ClearPhase): boolean {
  return phase === "idle" || phase === "collapsing";
}

/** True while the mark stands alone in place of the thread. */
export function showsMark(phase: ClearPhase): boolean {
  return phase === "collapsing" || phase === "absorbed";
}

/**
 * Whether Undo is on offer. Only once the page has settled — offering it
 * mid-collapse would have the author undoing something still in motion.
 */
export function offersUndo(phase: ClearPhase, token: string | null): boolean {
  return phase === "offered" && Boolean(token);
}

/**
 * How far the collapse has run, 0 to 1, at a given moment. Used to drive the
 * thread's fall and the mark's arrival from one clock.
 */
export function collapseProgress(elapsedMs: number): number {
  const t = elapsedMs / CLEAR_TIMING.collapseMs;
  return Math.min(1, Math.max(0, t));
}
