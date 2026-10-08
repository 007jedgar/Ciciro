// The onboarding quiz's answers, written to the device only once signup
// succeeds (see AGENTS.md "Pre-signup onboarding" and AuthScreen's
// `signedIn`). Everything before that point is in-memory route params, not
// persisted - a quiz abandoned before signup leaves nothing behind.

import { getPrefs } from "./prefs";
import { isManuscriptKind, type ManuscriptKind } from "./manuscript-kind";
import { parseObstacles, serializeObstacles, type Obstacle } from "./onboarding";

const KIND_KEY = "onboarding-goal-kind";
/** One id before the question took several answers, a comma-separated list now: `parseObstacles` reads both. */
const OBSTACLE_KEY = "onboarding-obstacle";

export function saveOnboardingAnswers(kind: ManuscriptKind, obstacles: readonly Obstacle[]): void {
  try {
    getPrefs().set(KIND_KEY, kind);
    if (obstacles.length > 0) getPrefs().set(OBSTACLE_KEY, serializeObstacles(obstacles));
    else getPrefs().remove(OBSTACLE_KEY);
  } catch {
    /* web / tests / missing native module */
  }
}

export function getOnboardingAnswers(): { kind: ManuscriptKind | null; obstacles: Obstacle[] } {
  try {
    const prefs = getPrefs();
    const kind = prefs.getString(KIND_KEY);
    return {
      kind: isManuscriptKind(kind) ? kind : null,
      obstacles: parseObstacles(prefs.getString(OBSTACLE_KEY)),
    };
  } catch {
    return { kind: null, obstacles: [] };
  }
}
