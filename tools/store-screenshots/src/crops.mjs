// Where each floating card is cut from its capture, as fractions of the
// capture (x, y, w, h from the top left) so one rect serves any resolution.
// Phone and tablet captures lay screens out differently, so they have their
// own rects. Re-tune these after re-capturing if a screen moved.

export const CROPS = {
  phone: {
    // The notification banner as it lands over the home screen.
    notification: { x: 0.02, y: 0.045, w: 0.96, h: 0.095 },
    // The top of the Writing history screen: days written, the calm count.
    history: { x: 0, y: 0.06, w: 1, h: 0.62 },
    // The tracked-changes bar: Accept all / Reject all and the count.
    suggestionsBar: { x: 0.03, y: 0.2, w: 0.94, h: 0.12 },
    // The prompt on the guided exercise.
    exerciseCard: { x: 0.05, y: 0.3, w: 0.9, h: 0.3 },
    // The "What to write next" part of the Weekly review.
    weeklyNext: { x: 0.04, y: 0.62, w: 0.92, h: 0.22 },
    // One character entry in the Story bible.
    bibleEntry: { x: 0.04, y: 0.3, w: 0.92, h: 0.16 },
  },
  tablet: {
    notification: { x: 0.55, y: 0.02, w: 0.43, h: 0.06 },
    history: { x: 0, y: 0.04, w: 1, h: 0.62 },
    suggestionsBar: { x: 0.05, y: 0.18, w: 0.9, h: 0.1 },
    exerciseCard: { x: 0.1, y: 0.3, w: 0.8, h: 0.26 },
    weeklyNext: { x: 0.06, y: 0.6, w: 0.88, h: 0.2 },
    bibleEntry: { x: 0.06, y: 0.3, w: 0.88, h: 0.14 },
  },
};
