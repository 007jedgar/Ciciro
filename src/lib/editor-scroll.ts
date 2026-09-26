import { prefersReducedMotion } from "@/lib/motion";

/** Where a jumped-to line rests in the pane: a little above the middle reads best. */
export const REST_FRACTION = 0.4;

/**
 * How far to scroll `pane` so the line at viewport `top`..`bottom` sits
 * `fraction` of the way down it. Below `deadband` pixels it is already there.
 */
export function scrollDeltaTo(
  top: number,
  bottom: number,
  paneTop: number,
  paneHeight: number,
  fraction = REST_FRACTION,
  deadband = 6
): number {
  const delta = (top + bottom) / 2 - (paneTop + paneHeight * fraction);
  return Math.abs(delta) < deadband ? 0 : delta;
}

/** Scroll smoothly (instantly when motion is reduced). */
export function scrollPaneBy(pane: HTMLElement, delta: number): void {
  if (delta === 0) return;
  pane.scrollBy({ top: delta, behavior: prefersReducedMotion() ? "instant" : "smooth" });
}

const tweens = new WeakMap<HTMLElement, number>();

/**
 * Scroll by `delta` over `ms` with an ease-out, retargeting a tween already in
 * flight. The typewriter re-centres on every keystroke, and the browser's own
 * smooth scrolling is cancelled by ProseMirror scrolling the caret into view,
 * so this drives scrollTop directly.
 */
export function tweenScrollBy(pane: HTMLElement, delta: number, ms: number): void {
  const running = tweens.get(pane);
  if (running !== undefined) cancelAnimationFrame(running);
  tweens.delete(pane);
  if (delta === 0) return;
  if (ms <= 0 || prefersReducedMotion()) {
    pane.scrollBy({ top: delta, behavior: "instant" });
    return;
  }
  const from = pane.scrollTop;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    pane.scrollTop = from + delta * eased;
    if (t < 1) tweens.set(pane, requestAnimationFrame(step));
    else tweens.delete(pane);
  };
  tweens.set(pane, requestAnimationFrame(step));
}
