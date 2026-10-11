// How much of the monthly AI allowance each action costs. One place, so the
// weighting is never re-derived differently at each call site. See
// docs/billing.md#the-ai-allowance.
//
// Every "AI action" used to cost a flat 1 unit regardless of how much model
// spend it caused: an autowrite run (up to 17 model calls drafting a whole
// chapter) could cost 15-20x a chat message yet charged the same. Autowrite
// is now weighted by its requested length. Everything else that charges the
// allowance (chat, continuity check, style analysis, weekly review, "I'm
// stuck") stays a flat 1 unit - `UsageCounter.aiRuns` is a D1 integer column,
// and splitting it into fractional units cannot be done as an additive-only
// schema change (see AGENTS.md "Production D1 schema"), so a cheaper action
// like "stuck" is not weighted down below 1 for now.

const AUTOWRITE_REFERENCE_WORDS = 2500;
const AUTOWRITE_REFERENCE_WEIGHT = 6;
const AUTOWRITE_MIN_WEIGHT = 2;

/**
 * Allowance units one autowrite run costs, scaled against a ~2,500-word
 * chapter costing 6 units (roughly its real cost ratio to a chat message),
 * floored at 2 so even a short run still reflects its multi-call cost.
 */
export function autowriteWeight(targetWords: number): number {
  const scaled = Math.round((AUTOWRITE_REFERENCE_WEIGHT * targetWords) / AUTOWRITE_REFERENCE_WORDS);
  return Math.max(AUTOWRITE_MIN_WEIGHT, scaled);
}
