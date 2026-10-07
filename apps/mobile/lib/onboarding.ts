// The pre-signup onboarding quiz: two questions, each answer routing to one
// of the demos phase 1 ships. Local state only - see AGENTS.md "Pre-signup
// onboarding". No AI or server calls anywhere in this flow.

export const OBSTACLES = ["zone", "creativity", "consistency", "block", "self_criticism", "unsure"] as const;
export type Obstacle = (typeof OBSTACLES)[number];

export function isObstacle(value: unknown): value is Obstacle {
  return typeof value === "string" && (OBSTACLES as readonly string[]).includes(value);
}

export const DEMO_PATHS = ["focus_typewriter", "suggestions_not_overwrites"] as const;
export type DemoPath = (typeof DEMO_PATHS)[number];

/**
 * Which demo a Q2 answer opens. Phase 1 ships exactly the two demos that need
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

export function demoForObstacle(obstacle: Obstacle): DemoPath {
  return DEMO_BY_OBSTACLE[obstacle];
}
