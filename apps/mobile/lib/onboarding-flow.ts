// What the pre-signup onboarding carries from screen to screen, as route
// params (see AGENTS.md "Pre-signup onboarding"). Nothing here is persisted:
// `AuthScreen`'s `signedIn` is the only place any of it is written, and only
// when the sign-up really created an account.

import { normalizeKind, type ManuscriptKind } from "./manuscript-kind";
import { parseObstacles, serializeObstacles, wantsReminderStep, type Obstacle } from "./onboarding";
import { isThemeId, type ThemeId } from "./theme";
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
  theme: ThemeId | null;
  reminder: WritingReminder | null;
};

export type OnboardingParams = {
  kind?: string;
  obstacles?: string;
  theme?: string;
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
    theme: isThemeId(params.theme) ? params.theme : null,
    reminder,
  };
}

/** Route params for the next screen; empty answers are left out so a link stays short. */
export function onboardingParams(state: Partial<OnboardingState>): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.kind) out.kind = state.kind;
  if (state.obstacles && state.obstacles.length > 0) out.obstacles = serializeObstacles(state.obstacles);
  if (state.theme) out.theme = state.theme;
  if (state.reminder) out.reminder = JSON.stringify(state.reminder);
  return out;
}

export const ONBOARDING_STEPS = ["goal", "obstacle", "look", "demo", "reminder", "account"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The steps this person will see: the reminder step is there only when their obstacles ask for it. */
export function stepsFor(obstacles: readonly Obstacle[]): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => step !== "reminder" || wantsReminderStep(obstacles));
}
