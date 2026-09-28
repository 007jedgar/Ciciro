import { DRAFTER_FAST_MODEL, DRAFTER_MODEL, EDITOR_MODEL } from "@/lib/anthropic";
import { hasGroqKey, ROUTER_MODEL } from "@/lib/fast-lane";

// Human-readable names for the model ids Ciciro pins by default (see
// docs/CHANGELOG.md). An operator-set id that isn't in this map still shows,
// just without a friendly label - the raw id is always shown too.
const FRIENDLY_NAMES: Record<string, string> = {
  "claude-opus-5": "Claude Opus 5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "llama-3.1-8b-instant": "Llama 3.1 8B",
};

export type ModelRole = "editor" | "drafter" | "quickDrafts" | "router";

export type ModelSlot = { key: ModelRole; role: string; id: string; name: string };

export type ModelSummary = {
  slots: ModelSlot[];
  router: (ModelSlot & { provider: "groq" }) | null;
};

function slot(key: ModelRole, role: string, id: string): ModelSlot {
  return { key, role, id, name: FRIENDLY_NAMES[id] ?? id };
}

/** The models actually in effect right now - resolved env values or defaults. */
export function getModelSummary(): ModelSummary {
  return {
    slots: [
      slot("editor", "Editor", EDITOR_MODEL),
      slot("drafter", "Drafter", DRAFTER_MODEL),
      slot("quickDrafts", "Quick drafts", DRAFTER_FAST_MODEL),
    ],
    router: hasGroqKey() ? { ...slot("router", "Router", ROUTER_MODEL), provider: "groq" } : null,
  };
}
