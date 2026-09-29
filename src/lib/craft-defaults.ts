// Craft defaults: habits that model-written prose falls into and a writer of
// the author's book usually would not. The drafter is told to avoid them, the
// editor is told what they are so it can hold the drafter to them, and the
// post-draft check (src/lib/prose-tells.ts) looks for them in a returned draft.
// One list feeds all three, so they cannot drift apart.
//
// Sources, reworded for Ciciro rather than copied:
//  - The structural patterns in blader/humanizer (MIT, github.com/blader/humanizer),
//    built on Wikipedia's "Signs of AI writing".
//  - StoryScope (Russell et al., arXiv 2604.03136), whose released feature table
//    shows where Claude-written short fiction differs most from published human
//    fiction: feelings mirrored by setting, stated themes, an earnest-lyrical
//    register, long balanced sentences, avoidance in place of confrontation, and
//    tidy reconciling endings.
// Plot-level choices (how a story ends, whether a character grows) belong to the
// author, so they appear here only as "do not resolve unless the brief asks".
//
// Pure: no Prisma, no network. Shared by prompts.ts, prose-tells.ts and the demo.

import type { ManuscriptKind } from "@/lib/manuscript-kind";

/** One habit: a short label for check findings, and the instruction the drafter gets. */
export type CraftHabit = { name: string; rule: string };

export const FICTION_HABITS: CraftHabit[] = [
  {
    name: "mirrored mood",
    rule: "Show feeling through what people do and say. Do not make weather, light, or the setting mirror the mood, and do not list bodily sensations to name an emotion.",
  },
  {
    name: "stated meaning",
    rule: 'Do not state the theme, the lesson, or what a moment meant. No narrator commentary on meaning, and no closing line that explains the scene the reader just saw ("It was a lesson in...", "Something had changed.").',
  },
  {
    name: "staged contrast",
    rule: 'Do not stage a contrast against something no one claimed ("not X but Y", "It wasn\'t X. It was Y."). Say the thing.',
  },
  {
    name: "sounds wise",
    rule: 'No lines built to sound wise ("At its core...", "X is the language of Y") and no inflated significance ("a moment she would remember forever").',
  },
  {
    name: "default lyricism",
    rule: "Take the tone from the brief and the continuity. Do not default to an earnest or lyrical register; plain, wry, funny, or mixed registers are right when the voice has them.",
  },
  {
    name: "rhythm by rule",
    rule: "Prefer concrete, plain words and short, mostly coordinated sentences, and vary their length. Use a list or a group of three only when the meaning has that many parts. No metaphor sustained over several sentences, and no showy alliteration or cadence.",
  },
  {
    name: "repeated openings",
    rule: 'Do not start several sentences in a row with the same word ("She... She... She...").',
  },
  {
    name: "conflict avoided",
    rule: "When characters are in conflict and would say so, let them say so; not every conflict is silence and avoidance. Do not turn dialogue into a debate about the theme.",
  },
  {
    name: "tidy ending",
    rule: "Raise the pressure inside the beat, and stop at or just after its turn: no aftermath summary, time jump, reconciliation, or epiphany unless the brief asks for one.",
  },
];

export const NONFICTION_HABITS: CraftHabit[] = [
  {
    name: "staged point",
    rule: 'Say the point directly. No "not X but Y" contrast against a claim no one made, no run-up ("Here\'s the thing.", "Let\'s dive in."), and no one-line closer that repeats the paragraph ("That\'s the real win.").',
  },
  {
    name: "inflation",
    rule: 'No sayings that only sound deep and no inflated significance ("a pivotal moment", "the future looks bright"). Keep the fact and drop the dressing.',
  },
  {
    name: "stock wording",
    rule: 'Use "is", "are", and "has" rather than "serves as", "boasts", or "features". Avoid stock words such as delve, testament, tapestry, pivotal, crucial, showcase, vibrant, and an abstract "landscape".',
  },
  {
    name: "sales voice",
    rule: 'No sales language ("nestled", "breathtaking", "must-visit") and no unnamed authorities ("experts say").',
  },
  {
    name: "formatting by rule",
    rule: "Use a list or a group of three only when the meaning has that many parts. Do not bold phrases for decoration, and keep headings in sentence case with no emojis.",
  },
  {
    name: "send-off",
    rule: "End on the last concrete point, not a send-off.",
  },
];

/** The habits that apply to a kind of manuscript. A journal gets none: it is the author's own diary. */
export function craftHabitsFor(kind: ManuscriptKind): CraftHabit[] {
  switch (kind) {
    case "novel":
    case "screenplay":
      return FICTION_HABITS;
    case "blog":
      return NONFICTION_HABITS;
    default:
      return [];
  }
}

const VOICE_WINS =
  "The author's voice wins: when the voice notes or the continuity excerpt show the author doing any of these on purpose, do what the author does.";

/** Shared by the drafter, the editor, and the check: a default never cuts what the brief asks for. */
export const BRIEF_WINS =
  "Anything the brief explicitly asks for outranks these defaults: a required beat, line, or ending stays, even where a default says otherwise.";

/** The block appended to the drafter's system prompt, or "" for a kind with no craft defaults. */
export function drafterCraftDefaults(kind: ManuscriptKind): string {
  const habits = craftHabitsFor(kind);
  if (!habits.length) return "";
  const scope =
    kind === "blog"
      ? "Craft defaults:"
      : "Craft defaults (for narration and action; dialogue may break them when the character would talk that way):";
  return [scope, ...habits.map((h) => `- ${h.rule}`), VOICE_WINS, BRIEF_WINS].join("\n");
}

/** The section appended to the editor's system prompt so it can hold the drafter to the defaults. */
export function editorCraftSection(kind: ManuscriptKind): string {
  const habits = craftHabitsFor(kind);
  const list = habits.length
    ? `The drafter follows craft defaults that steer it away from habits common in model-written prose: ${habits
        .map((h) => h.name)
        .join(", ")}. The author's voice outranks them:\n`
    : "";
  return `# Craft defaults for drafted prose
${list}- Anything the author or a brief explicitly asks for outranks these defaults: a required beat, line, or ending stays in the draft and in your edit, even where a default or a CRAFT CHECK says otherwise.
- In a brief's voice notes, name anything the author does on purpose (from style.md and the manuscript) that a careful editor might otherwise cut, so the drafter keeps it.
- A dispatch_draft result can end with a CRAFT CHECK list of quoted spots. In your edit, fix each one, or keep it when it is the author's voice or the brief asked for it. Do not mention the list to the author.
- These defaults are for prose you and the drafter write. Do not apply them to the author's own prose unless the author asks for that kind of edit.`;
}

// --- Em dashes -----------------------------------------------------------------
//
// Ciciro writes no em dashes by default. An author who writes with them switches
// that off with one line in style.md: "Em dashes: allowed". New projects seed
// "Em dashes: not allowed" there (src/lib/bible.ts), so the switch is visible.

const EM_DASHES_ALLOWED = /^[ \t]*(?:[-*+][ \t]+)?\**em[ -]?dash(?:es)?\**[ \t]*:\**[ \t]*\**allowed\b/im;

/** True when the author's style.md switches Ciciro's em-dash ban off. */
export function emDashesAllowed(styleMd: string | null | undefined): boolean {
  return EM_DASHES_ALLOWED.test(styleMd || "");
}

/** The style.md line new projects start with. */
export const EM_DASH_STYLE_LINE =
  '- Em dashes: not allowed; Ciciro uses a hyphen "-" instead. Change this line to "Em dashes: allowed" if you write with them.';
