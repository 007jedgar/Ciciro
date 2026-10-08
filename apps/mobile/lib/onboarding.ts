// The pre-signup onboarding quiz: two questions (the second takes several
// answers), routing to one of the demos phase 1 ships. Local state only - see AGENTS.md "Pre-signup
// onboarding". No AI or server calls anywhere in this flow.

import type { ManuscriptKind } from "./manuscript-kind";

export const OBSTACLES = ["zone", "creativity", "consistency", "block", "self_criticism", "unsure"] as const;
export type Obstacle = (typeof OBSTACLES)[number];

export function isObstacle(value: unknown): value is Obstacle {
  return typeof value === "string" && (OBSTACLES as readonly string[]).includes(value);
}

export const DEMO_PATHS = ["focus_typewriter", "suggestions_not_overwrites"] as const;
export type DemoPath = (typeof DEMO_PATHS)[number];

/**
 * Which demo each obstacle opens. Phase 1 ships exactly the two demos that need
 * no account: Focus + Typewriter (AI-free, universal) and Suggestions, not
 * overwrites (AI-free, answers the self-criticism fear directly). Creativity
 * and writer's block get Suggestions for now too, until their own demos ship.
 */
const DEMO_BY_OBSTACLE: Record<Obstacle, DemoPath> = {
  zone: "focus_typewriter",
  consistency: "focus_typewriter",
  unsure: "focus_typewriter",
  creativity: "suggestions_not_overwrites",
  block: "suggestions_not_overwrites",
  self_criticism: "suggestions_not_overwrites",
};

/** The obstacle that gets the writing-reminder step after the demo. */
export const REMINDER_OBSTACLE: Obstacle = "consistency";

/**
 * The obstacles in a route param: comma-separated ids in the order they were
 * tapped. Unknown ids and repeats drop out, and "unsure" is exclusive, so a
 * stale or hand-edited link never reaches the rest of the flow malformed.
 */
export function parseObstacles(param: unknown): Obstacle[] {
  if (typeof param !== "string" || param === "") return [];
  const picked: Obstacle[] = [];
  for (const part of param.split(",")) {
    if (isObstacle(part) && !picked.includes(part)) picked.push(part);
  }
  return picked.includes("unsure") && picked.length > 1 ? picked.filter((o) => o !== "unsure") : picked;
}

export function serializeObstacles(obstacles: readonly Obstacle[]): string {
  return obstacles.join(",");
}

/**
 * Toggles one obstacle in a selection. "Not sure" stands alone: choosing it
 * clears the others, and choosing anything else clears it.
 */
export function toggleObstacle(selected: readonly Obstacle[], obstacle: Obstacle): Obstacle[] {
  if (selected.includes(obstacle)) return selected.filter((o) => o !== obstacle);
  if (obstacle === "unsure") return ["unsure"];
  return [...selected.filter((o) => o !== "unsure"), obstacle];
}

export function wantsReminderStep(obstacles: readonly Obstacle[]): boolean {
  return obstacles.includes(REMINDER_OBSTACLE);
}

/**
 * Which demo the answers open. With several obstacles picked, the demo most of
 * them point at wins, and a tie goes to whichever was tapped first. Nothing
 * picked (a skipped question) is Focus. A journal is the author's own life, so
 * it never gets invented prose: it always opens Focus, on a blank page.
 */
export function demoForAnswers(kind: ManuscriptKind, obstacles: readonly Obstacle[]): DemoPath {
  if (kind === "journal") return "focus_typewriter";
  const votes = new Map<DemoPath, number>();
  for (const obstacle of obstacles) {
    const path = DEMO_BY_OBSTACLE[obstacle];
    votes.set(path, (votes.get(path) ?? 0) + 1);
  }
  let best: DemoPath = "focus_typewriter";
  let bestVotes = 0;
  for (const obstacle of obstacles) {
    const path = DEMO_BY_OBSTACLE[obstacle];
    const count = votes.get(path) ?? 0;
    if (count > bestVotes) {
      best = path;
      bestVotes = count;
    }
  }
  return best;
}
