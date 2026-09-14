import type { EditorRunInput, EditorScope } from "./api/types";

export const CICIRO_INTENTS = ["continue", "rewrite", "describe"] as const;
export type CiciroIntent = (typeof CICIRO_INTENTS)[number];

export function asCiciroIntent(value: string | string[] | undefined): CiciroIntent | null {
  const first = Array.isArray(value) ? value[0] : value;
  return CICIRO_INTENTS.includes(first as CiciroIntent) ? (first as CiciroIntent) : null;
}

/** English briefs for the editor. These are model instructions, not UI copy. */
const INTENT_PROMPTS: Record<CiciroIntent, { message: string; kind: string; scope: EditorScope }> = {
  continue: {
    kind: "continue",
    scope: "chapter",
    message:
      "Continue the open chapter from where it stops. Write a brief and dispatch it to the drafter for ~300-400 words in my voice, tense, and POV, then edit the result and show it to me as a <draft> block.",
  },
  rewrite: {
    kind: "rewrite",
    scope: "selection",
    message:
      "Rewrite the selected passage in my voice. If nothing is selected, rewrite the last passage of the open chapter. Return the rewrite in a <draft> block, then a short note on what changed.",
  },
  describe: {
    kind: "describe",
    scope: "chapter",
    message:
      "Add sensory description to the open chapter's last beat — place, body, and atmosphere — without stalling the scene. Return the new or rewritten passage in a <draft> block.",
  },
};

export function chatRequestFromIntent(
  intent: CiciroIntent,
  ctx: { projectId: string; chapterId: string | null; selection?: string }
): EditorRunInput {
  const spec = INTENT_PROMPTS[intent];
  const selection = ctx.selection?.trim() ?? "";
  return {
    projectId: ctx.projectId,
    message: spec.message,
    kind: spec.kind,
    scope: spec.scope === "selection" && !selection ? "chapter" : spec.scope,
    activeChapterId: ctx.chapterId,
    ...(selection ? { selection } : {}),
  };
}

export function chatRequestFromComposer(
  message: string,
  ctx: { projectId: string; chapterId: string | null }
): EditorRunInput | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  return {
    projectId: ctx.projectId,
    message: trimmed,
    kind: "chat",
    scope: "chapter",
    activeChapterId: ctx.chapterId,
  };
}
