import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, EDITOR_MODEL, DRAFTER_MODEL } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { buildEditorContext } from "@/lib/context";
import { EDITOR_SYSTEM, DRAFTER_SYSTEM, AUTONOMOUS_DIRECTIVE } from "@/lib/prompts";
import { countWords, htmlToText } from "@/lib/text";

// The autonomous drafting loop. The editor (Opus) plans a chapter into beats;
// for each beat the drafter (Sonnet) writes prose from a brief, the editor edits
// it to final against canon, and it is accepted and appended. Structured and
// bounded (a workflow, not an open-ended agent), so progress is legible and cost
// is predictable. Emits progress events; checks shouldStop between beats.

type Beat = { goal: string; brief: string; wordTarget: number };
type PlanQuestion = { question: string; provisional: string; affects: string };
type Emit = (event: Record<string, unknown>) => void;

const MAX_BEATS = 8;
const EDITOR_SYS = `${EDITOR_SYSTEM}\n\n${AUTONOMOUS_DIRECTIVE}`;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function textBlocks(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Plain prose -> TipTap-friendly HTML paragraphs.
function proseToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function tailWords(text: string, n = 180): string {
  const words = text.trim().split(/\s+/);
  return words.slice(-n).join(" ");
}

async function planChapter(
  projectId: string,
  chapterId: string,
  targetWords: number,
  guidance: string
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
    max_tokens: 6000,
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
    system: [{ type: "text", text: EDITOR_SYS, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `<context>\n${context}\n</context>\n\n${instruction}` }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const parsed = JSON.parse(textBlocks(res)) as {
    beats: Beat[];
    openQuestions?: PlanQuestion[];
  };
  return {
    beats: (parsed.beats || []).slice(0, MAX_BEATS),
    openQuestions: parsed.openQuestions || [],
  };
}

async function draftBeat(beat: Beat, tail: string, isOpening: boolean): Promise<string> {
  const anthropic = getAnthropic();
  const continuity = isOpening
    ? "This opens the chapter. Do not restate any heading."
    : `Continue seamlessly from this; do not repeat it:\n<continuity>\n${tail}\n</continuity>`;
  const res = await anthropic.messages.create({
    model: DRAFTER_MODEL,
    max_tokens: clamp(beat.wordTarget * 3, 800, 4000),
    system: DRAFTER_SYSTEM,
    messages: [{ role: "user", content: `${beat.brief}\n\n${continuity}\n\nTarget length: about ${beat.wordTarget} words.` }],
  });
  return textBlocks(res);
}

async function editBeatToFinal(
  projectId: string,
  chapterId: string,
  beat: Beat,
  draft: string,
  tail: string
): Promise<string> {
  const context = await buildEditorContext(projectId, chapterId);
  const anthropic = getAnthropic();
  const instruction = `You are editing one drafted beat of the chapter to final. Enforce the story's voice,
POV, tense, and canon; tighten prose; fix any drift or continuity break with the text
before it. Beat goal: ${beat.goal}.
${tail ? `It follows this text:\n<before>\n${tail}\n</before>\n` : ""}
Here is the draft to edit:\n<draft>\n${draft}\n</draft>\n
Return ONLY the final edited prose for this beat - no commentary, no headings, no draft tags.`;

  const res = await anthropic.messages.create({
    model: EDITOR_MODEL,
    max_tokens: clamp(beat.wordTarget * 4, 1000, 5000),
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [{ type: "text", text: EDITOR_SYS, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `<context>\n${context}\n</context>\n\n${instruction}` }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  return textBlocks(res);
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

  emit({ type: "phase", v: "planning" });
  let beats: Beat[];
  let planQuestions: PlanQuestion[] = [];
  try {
    const plan = await planChapter(projectId, chapterId, targetWords, guidance);
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

  const existingText = htmlToText(chapter.content);
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
    const tail = tailWords(running);

    emit({ type: "beat", i: i + 1, n: beats.length, status: "drafting", goal: beat.goal });
    let prose: string;
    try {
      prose = await draftBeat(beat, tail, isOpening);
    } catch (e) {
      emit({ type: "note", v: `Beat ${i + 1} draft failed: ${(e as Error).message}` });
      continue;
    }

    emit({ type: "beat", i: i + 1, n: beats.length, status: "editing", goal: beat.goal });
    try {
      const edited = await editBeatToFinal(projectId, chapterId, beat, prose, tail);
      if (edited.trim()) prose = edited;
    } catch (e) {
      emit({ type: "note", v: `Beat ${i + 1} edit skipped: ${(e as Error).message}` });
    }

    if (!prose.trim()) continue;
    running = `${running}\n\n${prose}`.trim();
    newHtml += proseToHtml(prose);
    accepted++;
    emit({
      type: "beat",
      i: i + 1,
      n: beats.length,
      status: "accepted",
      goal: beat.goal,
      words: countWords(prose),
    });
    emit({ type: "prose", v: prose });
  }

  // Save the accumulated prose to the chapter.
  emit({ type: "phase", v: "saving" });
  const finalContent = (chapter.content || "") + newHtml;
  await prisma.chapter.update({
    where: { id: chapterId },
    data: { content: finalContent, wordCount: countWords(htmlToText(finalContent)) },
  });

  emit({
    type: "done",
    beats: accepted,
    words: countWords(running) - countWords(existingText),
    content: finalContent,
  });
}
