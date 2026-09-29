import type Anthropic from "@anthropic-ai/sdk";

export const THINKING_DISPLAY_UPDATES_BETA = "thinking-display-updates-2026-08-18";

// Models documented to accept `thinking.display: "updates"` (Fable 5 / 5.1,
// Mythos 5 / 5.1, Opus 5.5, Sonnet 5.5), matched on the resolved model id so an
// env override to anything else falls back to the plain adaptive config.
const UPDATES_MODEL = /claude-(?:fable-5|mythos-5|opus-5-5|sonnet-5-5)(?![0-9])/;

export function supportsThinkingUpdates(model: string): boolean {
  return UPDATES_MODEL.test(model);
}

export function adaptiveThinking(withUpdates: boolean): Anthropic.ThinkingConfigParam {
  return (
    withUpdates ? { type: "adaptive", display: "updates" } : { type: "adaptive" }
  ) as Anthropic.ThinkingConfigParam;
}

export function thinkingUpdatesRequestOptions(withUpdates: boolean) {
  return withUpdates
    ? { headers: { "anthropic-beta": THINKING_DISPLAY_UPDATES_BETA } }
    : undefined;
}

// A 400 that names the parameter or the beta: the only rejection worth
// retrying without progress notes.
export function isThinkingDisplayRejection(error: unknown): boolean {
  const e = error as { status?: unknown; message?: unknown } | null;
  if (!e || e.status !== 400) return false;
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    message.includes("display") ||
    message.includes("thinking-display-updates") ||
    message.includes("anthropic-beta")
  );
}
