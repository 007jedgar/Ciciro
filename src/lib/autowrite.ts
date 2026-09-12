import { prisma } from "@/lib/db";
import { prepareEditorRun, type EditorRunInput } from "@/lib/editor-run";

export const AUTOWRITE_KIND = "autowrite";

const MIN_WORDS = 200;
const MAX_WORDS = 4000;
const DEFAULT_WORDS = 600;

export function clampTargetWords(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_WORDS;
  return Math.max(MIN_WORDS, Math.min(MAX_WORDS, n));
}

/**
 * Author-turn text for an unattended chapter draft. The durable editor runner
 * treats this like any other turn: dispatch_draft, critique, insert_text, and
 * checkpoint across slices until verification passes.
 */
export function buildAutoWriteMessage(opts: {
  targetWords: number;
  guidance?: string;
}): string {
  const guidance = (opts.guidance || "").trim();
  return [
    `Draft the open chapter unattended to about ${opts.targetWords} words.`,
    guidance ? `Author guidance: ${guidance}` : "",
    "",
    "Work as a loop until the chapter reaches that length:",
    "1. Inspect the open chapter (read_chapter / list_passages) so you know where it stops and its current revision.",
    "2. Dispatch a self-contained brief with dispatch_draft for the next beat (about 200-400 words unless a shorter beat is right).",
    "3. Critique the returned prose against canon, voice, POV, tense, and continuity. Revise it yourself; re-dispatch only if the beat is still wrong.",
    "4. Persist the edited beat with insert_text (position end, or after the last passage). Use the latest expectedRevision. Do not leave prose only in chat.",
    "5. raise_question for any fork you had to decide, then continue.",
    "6. Repeat until the chapter is at the target length, then stop.",
    "",
    "The usual two-dispatch cap does not apply to this unattended run. Do not ask the author questions; decide provisionally and keep going. Do not emit a <draft> block instead of inserting.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export type AutoWriteRunInput = {
  projectId: string;
  chapterId?: string;
  targetWords?: unknown;
  guidance?: unknown;
  resumeTurnId?: string;
  clientTurnId?: string;
  continueFrom?: string;
};

/**
 * Create or resume the durable EditorRun for an Auto-draft pass. Same
 * prepare/claim/execute path as chat, with kind autowrite and chapter scope.
 */
export async function prepareAutoWriteRun(input: AutoWriteRunInput) {
  const resumeTurnId =
    typeof input.resumeTurnId === "string" ? input.resumeTurnId.trim() : "";
  const chapterId =
    typeof input.chapterId === "string" ? input.chapterId.trim() : "";

  if (resumeTurnId) {
    const prepared = await prepareEditorRun({
      projectId: input.projectId,
      resumeTurnId,
      continueFrom: input.continueFrom,
      kind: AUTOWRITE_KIND,
      scope: "chapter",
      autoMode: true,
      activeChapterId: chapterId || undefined,
    });
    return prepared;
  }

  if (!chapterId) throw new Error("projectId and chapterId required");
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, projectId: input.projectId },
  });
  if (!chapter) throw new Error("Chapter not found.");

  const targetWords = clampTargetWords(input.targetWords);
  const guidance = typeof input.guidance === "string" ? input.guidance.trim() : "";
  const payload: EditorRunInput = {
    projectId: input.projectId,
    activeChapterId: chapterId,
    kind: AUTOWRITE_KIND,
    scope: "chapter",
    autoMode: true,
    message: buildAutoWriteMessage({ targetWords, guidance }),
    clientTurnId:
      typeof input.clientTurnId === "string" ? input.clientTurnId.trim() : undefined,
  };
  return prepareEditorRun(payload);
}
