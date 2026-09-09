/**
 * The Living Page - a rotating set of short phrases that get "written," then
 * dissolve into a single-stroke line drawing of what they describe.
 *
 * Each `svg` is authored in a normalized 0..100 box so it can be scaled to any
 * screen. Keep them as continuous ink lines (multiple `M` subpaths are fine -
 * Skia's path trim animates across them in order, so the drawing appears to be
 * sketched in one motion).
 */
export type Scene = {
  /** The line that gets handwritten, in the app's serif voice. */
  phrase: string;
  /** Line-art in a 0..100 viewBox, drawn on after the phrase lifts away. */
  svg: string;
};

export const SCENES: Scene[] = [
  {
    phrase: "a ship on open water,",
    svg: [
      // sea
      "M16 70 q 6 -6 12 0 t 12 0 t 12 0 t 12 0 t 12 0",
      // hull
      "M30 61 L70 61 Q 64 71 50 71 Q 36 71 30 61 z",
      // mast
      "M50 61 L50 23",
      // mainsail
      "M50 27 Q 69 38 55 56 L50 56",
      // foresail
      "M50 31 Q 35 42 47 54",
    ].join(" "),
  },
  {
    phrase: "a storm gathering overhead,",
    svg: [
      // cloud
      "M30 46 Q 22 36 34 34 Q 37 23 51 27 Q 66 20 69 35 Q 82 35 78 47 Q 74 53 62 51 L37 51 Q 26 51 30 46 z",
      // rain
      "M40 55 L35 66",
      "M52 55 L47 67",
      "M64 55 L59 66",
    ].join(" "),
  },
  {
    phrase: "a sky brimming with stars.",
    svg: [
      // crescent moon
      "M64 29 A 21 21 0 1 0 64 71 A 15 15 0 1 1 64 29 z",
      // large star
      "M30 40 l2.3 4.7 l5 0.7 l-3.6 3.5 l0.9 5 l-4.6 -2.4 l-4.6 2.4 l0.9 -5 l-3.6 -3.5 l5 -0.7 z",
      // small star
      "M78 60 l1.6 3.3 l3.6 0.5 l-2.6 2.5 l0.6 3.6 l-3.2 -1.7 l-3.2 1.7 l0.6 -3.6 l-2.6 -2.5 l3.6 -0.5 z",
    ].join(" "),
  },
];
