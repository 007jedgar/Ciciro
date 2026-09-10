/**
 * The Living Page - short passages that write themselves onto the screen,
 * line by line, then fade and give way to the next. No imagery: the words
 * are the whole picture.
 *
 * Keep lines short (about 31 characters max) so they fit one line at the
 * welcome screen's type size on small phones.
 */
export type Passage = string[];

export const PASSAGES: Passage[] = [
  [
    "a ship on open water,",
    "a storm gathering overhead,",
    "a sky brimming with stars.",
  ],
  [
    "she kept the letter for years,",
    "unopened, in a coat pocket,",
    "until the winter it mattered.",
  ],
  [
    "the city slept under snow,",
    "one window still burned yellow,",
    "somebody was writing.",
  ],
  [
    "begin with one true sentence,",
    "then another,",
    "and a world follows.",
  ],
  [
    "the senator smiled for the room,",
    "shook every hand but one,",
    "and left before the questions.",
  ],
  [
    "we mistake motion for meaning,",
    "and speed for arrival,",
    "but only stillness sees.",
  ],
];

/**
 * Rotating invitations on the frosted-glass auth screen. Each is a promise
 * about clarity: Ciciro turns loose thoughts into something coherent.
 */
export const LEDES: string[] = [
  "Turn a sentence into a world.",
  "Bring your ideas into focus.",
  "Turn musings into meaning.",
  "Give scattered thoughts a shape.",
  "Write your way to clarity.",
  "Make the vague thing vivid.",
];
