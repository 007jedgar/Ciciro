// The frames, in the order the stores show them. Copy lives in
// copy/<locale>.json under the same id; the picture each one draws is in
// layouts.mjs. `captures` lists every real app capture the frame needs, as
// names under captures/<locale>/<source>/ (png). A frame whose status is not
// "shipped" is skipped unless you pass --include-planned.
//
// "planned" means the feature behind it has not shipped, so the frame must
// not reach a store listing. To swap one in when its feature ships:
//   1. capture the real screens (see README, "Capturing"),
//   2. set status to "shipped" (and move it to where it should sit),
//   3. npm run render.
//
// bg is one of the Archive paper stocks used by the homepage (see styles.css).

export const FRAMES = [
  { id: "hero", status: "shipped", bg: "ink", captures: ["editor"] },
  { id: "screenplay", status: "shipped", bg: "butter", captures: ["screenplay", "screenplay-pages"] },
  { id: "reminders", status: "shipped", bg: "vermilion", captures: ["reminder", "notification"] },
  { id: "commute", status: "shipped", bg: "paper", captures: ["sprint"] },
  { id: "suggest", status: "shipped", bg: "blush", captures: ["suggestions"] },
  { id: "exercise", status: "shipped", bg: "blue", captures: ["exercise-intro", "weekly-review-next"] },
  { id: "bible", status: "shipped", bg: "ink", captures: ["bible", "bible-entry"] },
  { id: "themes", status: "shipped", bg: "paper", captures: ["theme-ciciro", "theme-night", "theme-bookshelf"] },
  // Held: the camera-scan feature lives on fm/cic-scan-notes and has not shipped.
  { id: "scan", status: "planned", bg: "butter", captures: ["scan"] },
];

/** The one Play feature graphic. It reuses the first shipped frame's capture. */
export const FEATURE_GRAPHIC = { id: "feature", bg: "ink", captures: ["editor"] };
