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
