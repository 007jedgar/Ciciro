import { useSyncExternalStore } from "react";
import { makeMutable } from "react-native-reanimated";

/**
 * The hand-off from the native splash into the welcome screen.
 *
 * The native splash is the mark (a ring and three dots) at `MARK_SIZE` in the
 * middle of `SPLASH_BG`. `components/SplashOverlay.tsx` redraws it in JS at the
 * same size and place, hides the native one once that is on screen, and when
 * the app is ready plays one clock (`handoffClock`, in ms from 0 to
 * `HANDOFF.totalMs`): the ring lets go, the three dots fly to the first three
 * ruled lines of the welcome card (`WelcomeTargets`, measured by the card) and
 * the lines shrink to a caret as the page behind builds itself. The welcome
 * screen reads the same clock to build in, and starts typing at `phase` "done".
 * Anything else that is ready first (a signed-in author, Reduce motion, no
 * welcome card to land on) is a plain fade and the clock jumps to the end.
 */

/** The native splash image: `SplashScreenLogo`, 100pt, centred on `SPLASH_BG` (the brand tile at 48 units wide, see scripts/generate-brand-icons.mjs). */
export const SPLASH_BG = "#141414";
export const MARK = {
  size: 100,
  ringOuter: 81.25,
  ringBorder: 6.25,
  dot: 14.17,
  /** Distance from the middle dot's centre to each outer dot's centre. */
  dotGap: 19.79,
  ring: "#f3efe6",
  dotColor: "#e8442c",
} as const;

/** The ruled lines the dots become are this tall, and the caret they shrink to is this wide. */
export const BAR_HEIGHT = 6;
export const CARET_WIDTH = 2;

export const HANDOFF = {
  ringMs: 340,
  dotStartMs: 140,
  dotStaggerMs: 70,
  dotMs: 560,
  /** The splash colour fades out, uncovering the page. */
  bgFadeStartMs: 640,
  bgFadeMs: 380,
  /** The welcome screen's parts rise in from here, one `riseStaggerMs` after another. */
  riseStartMs: 700,
  riseMs: 520,
  riseStaggerMs: 50,
  /** The lines narrow to carets, one `collapseStaggerMs` after another. */
  collapseStartMs: 1420,
  collapseMs: 340,
  collapseStaggerMs: 90,
  totalMs: 1940,
  /** A plain fade (signed in, Reduce motion). */
  fadeMs: 240,
  /** How long to wait for the welcome card to say where its lines are before fading instead. */
  targetsWaitMs: 700,
  /** Never leave the splash up longer than this waiting for the app. */
  patienceMs: 6000,
} as const;

export type BarTarget = { x: number; y: number; width: number };
/** Where the card's first three lines are, in window coordinates (`y` is the top of a bar). */
export type WelcomeTargets = { bars: [BarTarget, BarTarget, BarTarget]; caretTop: number; caretHeight: number };

export type HandoffPhase = "pending" | "done";

type State = { phase: HandoffPhase; targets: WelcomeTargets | null };
let state: State = { phase: "pending", targets: null };
const listeners = new Set<() => void>();

/** The one clock the overlay plays and the welcome screen builds in on. Starts at 0 (hidden) on a cold start. */
export const handoffClock = makeMutable(0);

function set(next: State): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHandoffPhase(): HandoffPhase {
  return useSyncExternalStore(subscribe, () => state.phase);
}

export function useWelcomeTargets(): WelcomeTargets | null {
  return useSyncExternalStore(subscribe, () => state.targets);
}

/** Called by the welcome card once it knows where its lines are (and null when it leaves). */
export function setWelcomeTargets(targets: WelcomeTargets | null): void {
  if (sameTargets(state.targets, targets)) return;
  set({ ...state, targets });
}

function sameTargets(a: WelcomeTargets | null, b: WelcomeTargets | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.caretTop === b.caretTop &&
    a.caretHeight === b.caretHeight &&
    a.bars.every((bar, i) => bar.x === b.bars[i].x && bar.y === b.bars[i].y && bar.width === b.bars[i].width)
  );
}

/** The hand-off is over (or never needed): the page is fully built and the welcome screen may start writing. */
export function finishHandoff(): void {
  handoffClock.value = HANDOFF.totalMs;
  set({ ...state, phase: "done" });
}

/** For tests: back to a cold start, or straight to a finished hand-off. */
export function resetHandoff(done = false): void {
  handoffClock.value = done ? HANDOFF.totalMs : 0;
  set({ phase: done ? "done" : "pending", targets: null });
}
