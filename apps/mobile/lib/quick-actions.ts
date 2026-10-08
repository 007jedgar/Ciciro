import type { EditorRunInput, EditorScope } from "./api/editor-run-input";
import type { ManuscriptKind } from "./manuscript-kind";

/**
 * The chips above the chat on the web (`quickActionsFor` in src/lib/prompts.ts),
 * minus the continuity check, which opens a panel the phone does not have yet.
 * The Expo app cannot import from the Next app, so the briefs are copied here and
 * `test/quick-actions-parity.test.ts` fails when they drift. The briefs are model
 * instructions, so they stay in English; the chip labels are `quickActions.<id>`
 * in the locales.
 */
export type QuickAction = {
  id: string;
  scope: EditorScope;
  /** True when the brief asks Ciciro to change the manuscript, so Chat only explains instead of sending. */
  writes?: boolean;
  prompt: string;
};

export const QUICK_ACTIONS: Record<ManuscriptKind, QuickAction[]> = {
  novel: [
    {
      id: "prioritize",
      scope: "book",
      prompt:
        "Given the manuscript and the bible, tell me the single highest-leverage thing to work on next, then the next two. Be specific about where and why.",
    },
    {
      id: "critique-chapter",
      scope: "chapter",
      prompt:
        "Give a developmental critique of the open chapter: pacing, stakes, character, and where it drags or rushes. End with the 3 most important fixes, ranked.",
    },
    {
      id: "tighten-dialogue",
      scope: "selection",
      prompt:
        "Tighten the selected dialogue: cut filler, sharpen subtext, make each voice distinct. Return the rewrite in a <draft> block, then a short note on what changed.",
    },
    {
      id: "line-edit",
      scope: "selection",
      prompt:
        "Line edit the selected passage for rhythm, clarity, and word choice while keeping my voice. Return the edited passage in a <draft> block, then bullet the notable changes.",
    },
    {
      id: "align-theme",
      scope: "chapter",
      prompt:
        "Check the open chapter against the story's theme, tone, and POV (see style.md). Point to specific lines that drift and suggest on-theme alternatives.",
    },
    {
      id: "loose-ends",
      scope: "book",
      prompt:
        "Using plot.md and the manuscript, list open loops and setups that have not paid off. For each, suggest where and how to resolve it.",
    },
    {
      id: "questions",
      scope: "chapter",
      prompt:
        "Pose 5 sharp craft questions about the open chapter for me to sit with while I revise. Do not answer them.",
    },
    {
      id: "continue",
      scope: "chapter",
      prompt:
        "Continue the open chapter from where it stops. Write a brief and dispatch it to the drafter for ~300-400 words in my voice, tense, and POV, then edit the result and show it to me as a <draft> block.",
    },
    {
      id: "review-holes",
      scope: "chapter",
      prompt:
        "Reread the open chapter start to finish and report two things: (1) plot holes or continuity gaps - anything unexplained, contradicted, or missing setup; (2) passages that read out of order, as if a draft landed in the wrong spot (an abrupt time jump, a beat that references something not yet established, or prose that repeats or contradicts a nearby paragraph - this can happen when inserted drafts land at the wrong cursor position). For each issue, quote the exact line or paragraph, say what's wrong, and suggest the fix or the correct location.",
    },
    {
      id: "fix-misplaced",
      scope: "chapter",
      writes: true,
      prompt:
        "Find anything in the open chapter that does not belong on this chapter's throughline and move it to the chapter where it does belong. Follow the REORG PLAN in context (or call survey_structure if there isn't one). Prefer whole scenes. If you cannot tell the destination, ask me which chapter - one question.",
    },
  ],
  screenplay: [
    {
      id: "sp-prioritize",
      scope: "book",
      prompt:
        "Given the script so far, tell me the single highest-leverage thing to work on next, then the next two. Be specific about which scene and why.",
    },
    {
      id: "sp-critique-sequence",
      scope: "chapter",
      prompt:
        "Critique the open sequence as a screenplay: scene goals and turns, what plays on screen versus what is only on the page, subtext in the dialogue, and pacing. End with the 3 most important fixes, ranked.",
    },
    {
      id: "sp-tighten-dialogue",
      scope: "selection",
      prompt:
        "Tighten the selected dialogue: cut on-the-nose lines, sharpen subtext, make each voice distinct. Return the rewrite as script lines in a <draft> block, then a short note on what changed.",
    },
    {
      id: "sp-trim-action",
      scope: "selection",
      prompt:
        "Trim the selected action lines: present tense, visual only, no camera directions or interior thoughts. Return the result in a <draft> block.",
    },
    {
      id: "sp-continue",
      scope: "chapter",
      prompt:
        "Continue the open sequence from where it stops. Brief the drafter for about one page of script in standard format, then edit the result and show it to me as a <draft> block with one element per line.",
    },
    {
      id: "sp-questions",
      scope: "chapter",
      prompt:
        "Pose 5 sharp questions about the open sequence (what each character wants, what changes in the scene, what the audience knows) for me to sit with. Do not answer them.",
    },
  ],
  blog: [
    {
      id: "blog-hook",
      scope: "chapter",
      prompt:
        "Critique the opening of this piece: does the first line and first paragraph give a reader a reason to keep going? Rewrite the opening two ways in one <draft> block, labelled A and B.",
    },
    {
      id: "blog-headline",
      scope: "chapter",
      prompt:
        "Suggest five title and subtitle pairs for this piece, from plain to punchy. Note which you would pick and why. Do not change the piece itself.",
    },
    {
      id: "blog-structure",
      scope: "chapter",
      prompt:
        "Read the piece for structure: is there one clear point, do the sections build in the right order, and where would a reader stop? Suggest subheads and any section to cut or move.",
    },
    {
      id: "blog-line-edit",
      scope: "selection",
      prompt:
        "Line edit the selected passage for clarity, rhythm, and a direct voice while keeping mine. Return the edited passage in a <draft> block, then bullet the notable changes.",
    },
    {
      id: "blog-ending",
      scope: "chapter",
      prompt:
        "Draft two possible endings for this piece (a closing line or two and, if it fits, a call to action), labelled A and B, in one <draft> block.",
    },
  ],
  journal: [
    {
      id: "journal-prompt",
      scope: "book",
      prompt:
        "Give me one gentle reflective prompt to write about today, based on my recent entries if there are any. Just the prompt and, at most, one line of why.",
    },
    {
      id: "journal-reflect",
      scope: "chapter",
      prompt:
        "Read this entry and ask me three open, kind questions that might help me see it more clearly. Do not critique the writing or tell me what I felt.",
    },
    {
      id: "journal-patterns",
      scope: "book",
      prompt:
        "Look across my entries and tell me what themes, moods, or recurring people and worries you notice. Quote short phrases from my own words as evidence and do not guess beyond them.",
    },
    {
      id: "journal-tidy",
      scope: "selection",
      prompt:
        "Lightly tidy the selected text for spelling and flow, keeping my voice and every fact. Return it in a <draft> block.",
    },
  ],
};

export function quickActionsFor(kind: ManuscriptKind): QuickAction[] {
  return QUICK_ACTIONS[kind];
}

/** A chip tap as a chat turn. `selection` is the highlighted text, sent only to an action scoped to it. */
export function chatRequestFromAction(
  action: QuickAction,
  ctx: { projectId: string; chapterId: string | null; selection?: string }
): EditorRunInput {
  const selection = ctx.selection?.trim() ?? "";
  return {
    projectId: ctx.projectId,
    message: action.prompt,
    kind: "action",
    scope: action.scope,
    activeChapterId: ctx.chapterId,
    ...(action.scope === "selection" && selection ? { selection } : {}),
  };
}
