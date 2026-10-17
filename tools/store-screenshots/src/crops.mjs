// Where each floating card is cut from its capture, as fractions of the
// capture (x, y, w, h from the top left) so one rect serves any resolution.
// Phone and tablet captures lay screens out differently, so they have their
// own rects. Re-tune these after re-capturing if a screen moved.

export const CROPS = {
  phone: {
    // The expanded reminder banner (long-pressed), measured from the capture.
    notification: { x: 0.0423, y: 0.095, w: 0.9146, h: 0.1373 },
    // The first suggestion on the Suggestions sheet (the metaphor swap): the struck text and its replacement, the whole card.
    suggestionCard: { x: 0.049, y: 0.5702, w: 0.9013, h: 0.2216 },
    // The "What to write next" part of the Weekly review (from weekly-review-next).
    weeklyNext: { x: 0.03, y: 0.7476, w: 0.94, h: 0.2021 },
    // The Description part of Rhonda Pruitt's entry (from bible-entry): "Hazel eyes, a laugh like a car alarm ...".
    bibleEntry: { x: 0.05, y: 0.4455, w: 0.9, h: 0.108 },
    // The top of the script's page view (the Pages tile): the sheet's text, without the empty page under it.
    scriptPage: { x: 0.052, y: 0.256, w: 0.896, h: 0.355 },
  },
  tablet: {
    // The expanded reminder banner, measured from the capture.
    notification: { x: 0.2011, y: 0.0389, w: 0.5979, h: 0.081 },
    suggestionCard: { x: 0.0189, y: 0.4873, w: 0.9617, h: 0.1065 },
    // "Loose ends" and "What to write next": the iPad shows the whole review on one screen.
    weeklyNext: { x: 0.02, y: 0.3797, w: 0.96, h: 0.1526 },
    // The top of Rhonda Pruitt's entry (from bible-entry), Hazel eyes included.
    bibleEntry: { x: 0.02, y: 0.0985, w: 0.96, h: 0.2031 },
    // The top of the script's page view: the sheet's text without the empty page under it.
    scriptPage: { x: 0.02, y: 0.185, w: 0.96, h: 0.538 },
  },
};
