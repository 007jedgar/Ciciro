import { Easing } from "react-native-reanimated";

/**
 * Easing curves the screen-level motion shares, so a push, a pop and a slid-in
 * list all settle the same way.
 *
 * `EASE_OUT` decelerates hard: it covers most of the distance in the first
 * frames and spends the rest settling, which suits short moves and the collapse
 * on the way out. `EASE_PUSH` is the iOS navigation curve, gentler at the start,
 * for something that has to cross the whole screen.
 */
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_PUSH = Easing.bezier(0.32, 0.72, 0, 1);

/**
 * Press feedback, shared by every pressable surface (`use-press-feedback.ts`).
 * One finger-down eases in over `PRESS_IN_MS` and back out over `PRESS_OUT_MS`
 * on `PRESS_EASE`; scale, opacity and tint all derive from that one progress.
 */
export const PRESS_IN_MS = 90;
export const PRESS_OUT_MS = 180;
/** The FAB lets go a little faster than a button. */
export const FAB_RELEASE_MS = 140;
export const PRESS_EASE = Easing.out(Easing.quad);

/** Pressed scale by surface. Reduce motion drops the scale and keeps the tint and dim. */
export const PRESS_SCALE = { card: 0.98, button: 0.97, chip: 0.96, fab: 0.92 } as const;

/** Pressed opacity: a surface (card, button) barely dips; a bare text link dips further. */
export const PRESS_DIM = { surface: 0.92, link: 0.55 } as const;

/** How far a pressed surface moves toward its tint (ink for accent fills, panel2 otherwise). */
export const TINT_MIX = 0.2;

/** Selection pop: up to `POP_PEAK` over `POP_UP_MS`, then a spring back (see `use-selection-pop.ts`). */
export const POP_PEAK = 1.06;
export const POP_UP_MS = 90;
export const POP_SPRING = { damping: 14, stiffness: 220 } as const;
/** The colour crossfade when a single-select control flips. */
export const SELECT_FADE_MS = 180;

/** The menu over highlighted text fades and settles in over this long (see `components/SelectionMenu.tsx`). */
export const SELECTION_MENU_MS = 160;

/** The writing-frequency line: how long each period holds, and how fast it types and deletes. */
export const FREQ_HOLD_MS = 2600;
export const FREQ_DELETE_MS = 26;
export const FREQ_TYPE_MS = 42;

/**
 * The onboarding "carry" (see `lib/onboarding-shell.tsx`): the card a person taps
 * flies into a chip in the header over `CARRY_MS`. The screen it leaves fades
 * over `CARRY_LEAVE_MS`, the next screen is pushed `CARRY_PUSH_MS` in (so it
 * arrives as the card is leaving), and several cards (the obstacles) set off
 * `CARRY_STAGGER_MS` apart.
 */
export const CARRY_MS = 460;
export const CARRY_LEAVE_MS = 180;
export const CARRY_PUSH_MS = 200;
export const CARRY_STAGGER_MS = 50;
/** Reduce motion: the chip just fades in. */
export const CARRY_FADE_MS = 140;
