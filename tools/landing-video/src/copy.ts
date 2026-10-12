// The notification title/body/nudge are the same strings the landing page
// already renders as its canonical example reminder (see `SCENE` in
// src/components/landing/copy.ts), which itself mirrors the per-manuscript
// nudge format `composeSceneReminderBody` builds for a real device
// notification (src/lib/reminder-nudge-text.ts): "<excerpt>\n\n<nudge line>".
export const NOTIFICATION = {
  app: "Ciciro",
  title: "Time to write The Letter",
  excerpt: "She didn't need to unfold it, only to feel the weight of it.",
};

export const MANUSCRIPT = {
  chapterTitle: "The Letter",
  // The paragraph the writer is dropped into, ending on the same line the
  // notification quoted, so tapping it reads as "pick up right here."
  paragraph:
    "Mara turned the envelope over twice before she let herself look at the hand that had addressed it. She didn't need to unfold it, only to feel the weight of it.",
};
