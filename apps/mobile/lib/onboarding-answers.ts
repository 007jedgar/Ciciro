// The onboarding quiz's two answers, written to the device only once signup
// succeeds (see AGENTS.md "Pre-signup onboarding" and AuthScreen's
// `signedIn`). Everything before that point is in-memory route params, not
// persisted - a quiz abandoned before signup leaves nothing behind.

import { getPrefs } from "./prefs";
import { isManuscriptKind, type ManuscriptKind } from "./manuscript-kind";
import { isObstacle, type Obstacle } from "./onboarding";

const KIND_KEY = "onboarding-goal-kind";
const OBSTACLE_KEY = "onboarding-obstacle";

export function saveOnboardingAnswers(kind: ManuscriptKind, obstacle: Obstacle): void {
  try {
    getPrefs().set(KIND_KEY, kind);
    getPrefs().set(OBSTACLE_KEY, obstacle);
  } catch {
    /* web / tests / missing native module */
  }
}

export function getOnboardingAnswers(): { kind: ManuscriptKind | null; obstacle: Obstacle | null } {
  try {
    const prefs = getPrefs();
    const kind = prefs.getString(KIND_KEY);
    const obstacle = prefs.getString(OBSTACLE_KEY);
    return {
      kind: isManuscriptKind(kind) ? kind : null,
      obstacle: isObstacle(obstacle) ? obstacle : null,
    };
  } catch {
    return { kind: null, obstacle: null };
  }
}
