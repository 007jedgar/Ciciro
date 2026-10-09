/**
 * Small easing helpers for worklets. Each carries its own "worklet" directive:
 * Reanimated only auto-workletizes the callback passed straight to a hook, so a
 * plain function imported from another module needs one to be callable on the UI
 * runtime (see AGENTS.md, Mobile motion).
 */

/** How far `p` is from `a` to `b`, clamped to 0..1. */
export const seg = (p: number, a: number, b: number) => {
  "worklet";
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
};

export const mix = (a: number, b: number, t: number) => {
  "worklet";
  return a + (b - a) * t;
};

export const easeOut = (p: number) => {
  "worklet";
  return 1 - Math.pow(1 - p, 3);
};

export const easeInOut = (p: number) => {
  "worklet";
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};
