import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, EDITOR_MODEL, DRAFTER_MODEL } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { buildEditorContext } from "@/lib/context";
import {
  editorSystemFor,
  drafterSystemFor,
  editBeatInstruction,
  beatDraftMessage,
  PROSE_MAX_TOKENS,
  AUTONOMOUS_DIRECTIVE,
  type BeatCraft,
} from "@/lib/prompts";
import { proseOptions, type ProseOptions } from "@/lib/craft-options";
import { checkDraft, formatCraftCheck } from "@/lib/prose-tells";
import {
  assistantTextToHtml,
  normalizeKind,
  scriptDisplayText,
  type ManuscriptKind,
} from "@/lib/manuscript-kind";
import { lastScriptElement, scriptTail } from "@/lib/script-view";
import { chapterPlainText, chapterWordCount, countWords } from "@/lib/text";
import { writeChapterHtml } from "@/lib/chapter-writes";

// The autonomous drafting loop. The editor (Opus) plans a chapter into beats;
// for each beat the drafter (Sonnet) writes prose from a brief, the editor edits
// it to final against canon, and it is accepted and appended. Structured and
// bounded (a workflow, not an open-ended agent), so progress is legible and cost
// is predictable. Emits progress events; checks shouldStop between beats.

type Beat = { goal: string; brief: string; wordTarget: number };
type PlanQuestion = { question: string; provisional: string; affects: string };
type Emit = (event: Record<string, unknown>) => void;

const MAX_BEATS = 8;
function editorSys(kind: ManuscriptKind, craft: boolean) {
  return editorSystemFor(kind, AUTONOMOUS_DIRECTIVE, { craft });
}

async function kindOf(projectId: string): Promise<ManuscriptKind> {
  const row = await prisma.project.findUnique({ where: { id: projectId }, select: { kind: true } });
  return normalizeKind(row?.kind);
}

function textBlocks(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** The reply's text, refusing one that stopped at its token limit: a cut-off beat must never reach the chapter. */
function finishedText(res: Anthropic.Message, what: string): string {
  if (res.stop_reason === "max_tokens") throw new Error(`the ${what} ran past its length limit`);
  return textBlocks(res);
}

function tailWords(text: string, n = 180): string {
  const words = text.trim().split(/\s+/);
  return words.slice(-n).join(" ");
}

async function planChapter(
  projectId: string,
  chapterId: string,
  targetWords: number,
  guidance: string,
  craft: boolean
): Promise<{ beats: Beat[]; openQuestions: PlanQuestion[] }> {
  const context = await buildEditorContext(projectId, chapterId);
  const anthropic = getAnthropic();

  const instruction = `Plan the drafting of the OPEN CHAPTER to about ${targetWords} words${
    guidance ? `, following this guidance: ${guidance}` : ""
  }. Break it into a sequence of beats (max ${MAX_BEATS}). For EACH beat write a
complete, self-contained drafter brief - the drafter cannot see the bible or
manuscript, so include: POV and tense, the beat this passage must land, the specific
canon constraints it must not contradict, voice notes for any speaking character, what
to set up or pay off, and a short "do NOT" list. Do NOT include a continuity excerpt;
that is supplied at draft time. Set each beat's wordTarget so they sum to about
${targetWords}. If the chapter already has prose, plan beats that continue from where
it stops.
Do NOT stall on unknowns. For any fork the author has not decided (a name, a detail,
a plot choice), pick a reasonable option so drafting can proceed, and record it in
openQuestions (the question, what you went with, and where it lands) for reconciling
later.`;

  const res = await anthropic.messages.create({
    model: EDITOR_MODEL,
    max_tokens: PROSE_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            beats: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  goal: { type: "string" },
                  brief: { type: "string" },
                  wordTarget: { type: "integer" },
                },
                required: ["goal", "brief", "wordTarget"],
                additionalProperties: false,
              },
            },
            openQuestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  provisional: { type: "string" },
                  affects: { type: "string" },
                },
                required: ["question", "provisional", "affects"],
                additionalProperties: false,
              },
            },
          },
          required: ["beats"],
          additionalProperties: false,
        },
      },
    },
    system: editorSys(await kindOf(projectId), craft),
    messages: [{ role: "user", content: `<context>\n${context}\n</context>\n\n${instruction}` }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const parsed = JSON.parse(finishedText(res, "plan")) as {
    beats: Beat[];
    openQuestions?: PlanQuestion[];
  };
  return {
    beats: (parsed.beats || []).slice(0, MAX_BEATS),
    openQuestions: parsed.openQuestions || [],
  };
}

async function draftBeat(
  kind: ManuscriptKind,
  { craft, emDashes }: ProseOptions,
  beat: Beat,
  tail: string,
  isOpening: boolean
): Promise<string> {
  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: DRAFTER_MODEL,
    max_tokens: PROSE_MAX_TOKENS,
    system: drafterSystemFor(kind, { emDashes, craft }),
    messages: [{ role: "user", content: beatDraftMessage(beat.brief, tail, isOpening, beat.wordTarget) }],
  });
  return finishedText(res, "draft");
}

async function editBeatToFinal(
  projectId: string,
  chapterId: string,
  beat: Beat,
  draft: string,
  tail: string,
  craft: BeatCraft | undefined
): Promise<string> {
  const context = await buildEditorContext(projectId, chapterId);
  const anthropic = getAnthropic();
  const instruction = editBeatInstruction(beat.goal, draft, tail, craft);

  const res = await anthropic.messages.create({
    model: EDITOR_MODEL,
    max_tokens: PROSE_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: editorSys(await kindOf(projectId), craft !== undefined),
    messages: [{ role: "user", content: `<context>\n${context}\n</context>\n\n${instruction}` }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  return finishedText(res, "edit");
}

/**
 * Commit the run's prose onto the chapter as it stands right now.
 *
 * The beats above stream for minutes, and the author can be typing in another
 * window the whole time. The chapter is re-read here instead of reusing the
 * snapshot the run planned against, so the new prose is appended after their
 * paragraphs rather than over them, and the compare-and-swap inside
 * `writeChapterHtml` means a commit that still raced a keystroke is retried
 * against the newer head instead of winning.
 */
async function commitProse(
  chapterId: string,
  projectId: string,
  newHtml: string,
  runId: string
): Promise<{ content: string; revision: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!current) return null;
    const written = await writeChapterHtml(
      {
        id: current.id,
        projectId,
        content: current.content,
        revision: current.revision,
      },
      (current.content || "") + newHtml,
      { actor: "ai", runId, tally: "drafted" }
    );
    if (written.ok) return { content: written.content, revision: written.revision };
  }
  return null;
}

export async function runAutoWrite(opts: {
  projectId: string;
  chapterId: string;
  targetWords: number;
  guidance: string;
  emit: Emit;
  shouldStop: () => boolean;
}): Promise<void> {
  const { projectId, chapterId, targetWords, guidance, emit, shouldStop } = opts;

  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) {
    emit({ type: "error", v: "Chapter not found." });
    return;
  }

  const kind = await kindOf(projectId);
  const options = await proseOptions(projectId);

  emit({ type: "phase", v: "planning" });
  let beats: Beat[];
  let planQuestions: PlanQuestion[] = [];
  try {
    const plan = await planChapter(projectId, chapterId, targetWords, guidance, options.craft);
    beats = plan.beats;
    planQuestions = plan.openQuestions;
  } catch (e) {
    emit({ type: "error", v: `Planning failed: ${(e as Error).message}` });
    return;
  }
  if (!beats.length) {
    emit({ type: "error", v: "The editor produced no beats to draft." });
    return;
  }
  emit({ type: "plan", beats: beats.map((b) => ({ goal: b.goal, wordTarget: b.wordTarget })) });

  // Persist any assumptions the plan made so they surface as open questions.
  for (const q of planQuestions) {
    if (!q.question?.trim()) continue;
    await prisma.openQuestion.create({
      data: {
        projectId,
        question: q.question.trim(),
        provisional: (q.provisional || "").trim(),
        affects: (q.affects || "").trim(),
        chapterId,
      },
    });
    emit({ type: "note", v: `Open question: ${q.question} (went with: ${q.provisional || "n/a"})` });
  }

  const script = kind === "screenplay";
  const existingText = chapterPlainText(chapter.content);
  let running = existingText; // accumulated plain text for continuity
  let newHtml = ""; // html to append to the chapter
  let accepted = 0;

  for (let i = 0; i < beats.length; i++) {
    if (shouldStop()) {
      emit({ type: "stopped" });
      break;
    }
    const beat = beats[i];
    const isOpening = i === 0 && !existingText.trim();
    // A script continues from its last few elements as marked script lines, so
    // the drafter sees the format and who is speaking; prose from its last words.
    const tail = script ? scriptTail(chapter.content + newHtml) : tailWords(running);

    emit({ type: "beat", i: i + 1, n: beats.length, status: "drafting", goal: beat.goal });
    let prose: string;
    try {
      prose = await draftBeat(kind, options, beat, tail, isOpening);
    } catch (e) {
      emit({ type: "note", v: `Beat ${i + 1} draft failed: ${(e as Error).message}` });
      continue;
    }

    emit({ type: "beat", i: i + 1, n: beats.length, status: "editing", goal: beat.goal });
    try {
      // Craft defaults are opt-in ("Experimental writing prompt"); off, the edit
      // gets no brief, no check, and no extra call.
      const craft = options.craft
        ? {
            brief: beat.brief,
            check: formatCraftCheck(
              await checkDraft(script ? scriptDisplayText(prose) : prose, {
                kind,
                emDashes: options.emDashes,
                brief: beat.brief,
              })
            ),
          }
        : undefined;
      const edited = await editBeatToFinal(projectId, chapterId, beat, prose, tail, craft);
      if (edited.trim()) prose = edited;
    } catch (e) {
      emit({ type: "note", v: `Beat ${i + 1} edit skipped: ${(e as Error).message}` });
    }

    if (!prose.trim()) continue;
    // What the author reads is the script without its line marks.
    const shown = script ? scriptDisplayText(prose) : prose;
    running = `${running}\n\n${shown}`.trim();
    // A beat that opens on dialogue continues the speech the last element left open.
    newHtml += assistantTextToHtml(prose, kind, script ? lastScriptElement(chapter.content + newHtml) : undefined);
    accepted++;
    emit({
      type: "beat",
      i: i + 1,
      n: beats.length,
      status: "accepted",
      goal: beat.goal,
      words: countWords(shown),
    });
    emit({ type: "prose", v: shown });
  }

  // Save the accumulated prose to the chapter. The beat events above are
  // progress, not ops: a token stream that wrote an op per chunk would flood
  // the log and re-render the phone on every chunk. One stream, one commit.
  emit({ type: "phase", v: "saving" });
  const saved = await commitProse(chapterId, projectId, newHtml, crypto.randomUUID());
  if (!saved) {
    emit({
      type: "error",
      v: "The chapter changed while the draft was running; the new prose was not saved.",
    });
    return;
  }

  emit({
    type: "done",
    beats: accepted,
    words: countWords(running) - countWords(existingText),
    content: saved.content,
    revision: saved.revision,
    wordCount: chapterWordCount(saved.content),
  });
}
