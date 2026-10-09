// The "story so far" the onboarding header keeps: one chip per answer, in the
// order they were given (see `lib/onboarding-shell.tsx` and AGENTS.md
// "Pre-signup onboarding"). Pure helpers, so the rules for what a chip is and
// when it goes away are testable without a screen.

import { ONBOARDING_STEPS, type OnboardingStep } from "./onboarding-flow";
import { formatReminderClock, reminderDaySummary, type ReminderTranslate, type WritingReminder } from "./writing-reminders";

export type StoryChip = {
  /** Stable across re-answers: `kind`, `obstacle:zone`, `theme`, `reminder`. */
  id: string;
  /** The step whose answer this is; the chip arrives as that step is left. */
  step: OnboardingStep;
  label: string;
};

/** Adds chips after the ones already there; a chip with the same id is replaced in place. */
export function addChips(chips: readonly StoryChip[], added: readonly StoryChip[]): StoryChip[] {
  const out = [...chips];
  for (const chip of added) {
    const at = out.findIndex((existing) => existing.id === chip.id);
    if (at >= 0) out[at] = chip;
    else out.push(chip);
  }
  return out;
}

/**
 * The chips left when `step` is shown (again): only the answers given before it.
 * Coming back to a step takes back what it and everything after it gave, so
 * the header always reads the answers that lead to the screen in front of you.
 */
export function chipsBefore(chips: readonly StoryChip[], step: OnboardingStep): StoryChip[] {
  const at = ONBOARDING_STEPS.indexOf(step);
  return chips.filter((chip) => ONBOARDING_STEPS.indexOf(chip.step) < at);
}

/** What a screen reader hears for the whole row, or null while there is nothing in it. */
export function answersSummary(chips: readonly StoryChip[], format: (answers: string) => string): string | null {
  if (chips.length === 0) return null;
  return format(chips.map((chip) => chip.label).join(", "));
}

/** The reminder as a chip reads it: "Every day, 8:00 PM". */
export function reminderChipLabel(reminder: WritingReminder, locale: string, t: ReminderTranslate): string {
  return `${reminderDaySummary(reminder.days, t)}, ${formatReminderClock(reminder.hour, reminder.minute, locale)}`;
}
