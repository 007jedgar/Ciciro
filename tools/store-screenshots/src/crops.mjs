// Where each floating card is cut from its capture, as fractions of the
// capture (x, y, w, h from the top left) so one rect serves any resolution.
// Phone and tablet captures lay screens out differently, so they have their
// own rects. Re-tune these after re-capturing if a screen moved.

export const CROPS = {
  phone: {
    // The expanded reminder banner (long-pressed), measured from the capture.
    notification: { x: 0.0415, y: 0.0946, w: 0.9163, h: 0.1194 },
    // The second suggestion on the Suggestions sheet: the struck text and its replacement, the whole card.
    suggestionCard: { x: 0.054, y: 0.752, w: 0.892, h: 0.222 },
    // The "What to write next" part of the Weekly review (from weekly-review-next).
    weeklyNext: { x: 0.03, y: 0.745, w: 0.94, h: 0.205 },
    // The description line of Ines Lind's entry (from bible-entry): "Grey eyes ...".
    bibleEntry: { x: 0.06, y: 0.372, w: 0.88, h: 0.085 },
    // The top of the script's page view (the Pages tile): the sheet's text, without the empty page under it.
    scriptPage: { x: 0.052, y: 0.256, w: 0.896, h: 0.34 },
  },
  tablet: {
    // The expanded reminder banner, measured from the capture.
    notification: { x: 0.2001, y: 0.0378, w: 0.6003, h: 0.0705 },
    suggestionCard: { x: 0.018, y: 0.581, w: 0.964, h: 0.112 },
    // "Loose ends" and "What to write next": the iPad shows the whole review on one screen.
    weeklyNext: { x: 0.02, y: 0.372, w: 0.96, h: 0.163 },
    // The top of Ines Lind's entry (from bible-entry), Grey eyes included.
    bibleEntry: { x: 0.02, y: 0.09, w: 0.96, h: 0.25 },
    // The top of the script's page view: the sheet's text without the empty page under it.
    scriptPage: { x: 0.02, y: 0.185, w: 0.96, h: 0.5 },
  },
};
