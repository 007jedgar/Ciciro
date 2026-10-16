// What the pre-signup onboarding carries from screen to screen, as route
// params (see AGENTS.md "Pre-signup onboarding"). Nothing here is persisted:
// `AuthScreen`'s `signedIn` is the only place any of it is written, and only
// when the sign-up really created an account.

import { normalizeKind, type ManuscriptKind } from "./manuscript-kind";
import { parseObstacles, serializeObstacles, wantsExercisesStep, wantsReminderStep, type Obstacle } from "./onboarding";
import {
  DEFAULT_REMINDER_MINUTE,
  newWritingReminder,
  parseWritingReminder,
  type WritingReminder,
} from "./writing-reminders";

/** The reminder the onboarding offers: every evening at eight, all manuscripts. */
export const ONBOARDING_REMINDER_HOUR = 20;

export type OnboardingState = {
  kind: ManuscriptKind;
  obstacles: Obstacle[];
  reminder: WritingReminder | null;
};

export type OnboardingParams = {
  kind?: string;
  obstacles?: string;
  reminder?: string;
};

/** The reminder a person sees first in the onboarding form (8 PM, every day). */
export function onboardingReminderDraft(id: string): WritingReminder {
  return { ...newWritingReminder({ id }), hour: ONBOARDING_REMINDER_HOUR, minute: DEFAULT_REMINDER_MINUTE };
}

export function parseOnboardingParams(params: OnboardingParams): OnboardingState {
  let reminder: WritingReminder | null = null;
  if (typeof params.reminder === "string" && params.reminder) {
    try {
      reminder = parseWritingReminder(JSON.parse(params.reminder));
    } catch {
      reminder = null;
    }
  }
  return {
    kind: normalizeKind(params.kind),
    obstacles: parseObstacles(params.obstacles),
    reminder,
  };
}

/** Route params for the next screen; empty answers are left out so a link stays short. */
export function onboardingParams(state: Partial<OnboardingState>): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.kind) out.kind = state.kind;
  if (state.obstacles && state.obstacles.length > 0) out.obstacles = serializeObstacles(state.obstacles);
  if (state.reminder) out.reminder = JSON.stringify(state.reminder);
  return out;
}

export const ONBOARDING_STEPS = ["goal", "obstacle", "look", "demo", "exercises", "reminder", "account"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * The steps this person will see: the exercises step is there only for
 * creativity or writer's block, and the reminder step only when their obstacles
 * ask for it.
 */
export function stepsFor(obstacles: readonly Obstacle[]): OnboardingStep[] {
  return ONBOARDING_STEPS.filter(
    (step) =>
      (step !== "exercises" || wantsExercisesStep(obstacles)) && (step !== "reminder" || wantsReminderStep(obstacles))
  );
}

/** Where the flow goes after `step` for these answers: the next step this person sees, with signup after the last. */
export function pathAfter(step: OnboardingStep, obstacles: readonly Obstacle[]): "/onboarding/exercises" | "/onboarding/reminder" | "/signup" {
  const steps = stepsFor(obstacles);
  const next = steps[steps.indexOf(step) + 1];
  if (next === "exercises") return "/onboarding/exercises";
  if (next === "reminder") return "/onboarding/reminder";
  return "/signup";
}
