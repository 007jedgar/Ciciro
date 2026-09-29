// The side-by-side demo engine: runs each fixed scene through the current
// pipeline (arm A) and the craft-defaults pipeline (arm B), exactly as one
// auto-draft beat runs in src/lib/autowrite.ts, then has Opus judge each pair
// blind in both orders. The client is injected, so a dry run with a mock client
// exercises every step without an API key.
//
// Arm A uses the `craft: false` prompts, which test/craft-defaults.test.ts pins
// byte for byte to the prompts as they were before craft defaults. The one
// shared difference is EDITOR_SYSTEM's dash rule, which now also says how an
// author switches dashes on; with style.md leaving them off it changes nothing.

import type Anthropic from "@anthropic-ai/sdk";
import { DRAFTER_MODEL, EDITOR_MODEL } from "@/lib/anthropic";
import { emDashesAllowed } from "@/lib/craft-defaults";
import {
  AUTONOMOUS_DIRECTIVE,
  beatDraftMessage,
  drafterSystemFor,
  editBeatInstruction,
  editorSystemFor,
} from "@/lib/prompts";
import { checkDraft, formatCraftCheck, type CraftFinding } from "@/lib/prose-tells";
import type { DemoScene } from "./scenes";

export type Client = Pick<Anthropic, "messages">;
export type Arm = "A" | "B";
export type Verdict = "A" | "B" | "tie";

export type ArmRun = {
  draft: string;
  /** The CRAFT CHECK the editor received (arm B only). */
  craftCheck: string;
  final: string;
  /** The check run over the final text, for the page's annotations. */
  finalFindings: CraftFinding[];
  metrics: TextMetrics;
  error?: string;
};

export type Judgment = {
  /** Which arm was shown as Passage 1. */
  firstShown: Arm;
  quality: Verdict;
  voice: Verdict;
  brief: Verdict;
  reason: string;
  error?: string;
};

export type PairRun = { sample: number; A: ArmRun; B: ArmRun; judgments: Judgment[] };
export type SceneRun = { scene: DemoScene; pairs: PairRun[] };

export type Usage = { model: string; input: number; output: number };

export type DemoResult = {
  dryRun: boolean;
  startedAt: string;
  models: { drafter: string; editor: string };
  samples: number;
  scenes: SceneRun[];
  usage: Usage[];
};

// --- Metrics ---------------------------------------------------------------------

export type TextMetrics = {
  words: number;
  dashesPer1k: number;
  contrasts: number;
  meanSentence: number;
  sentenceSpread: number;
};

const CONTRAST = [
  /\b(?:not|n't)\s+(?:just|only|merely|simply)\s+[^.;!?\n]{1,50}?[,;]?\s+but\b/gi,
  /\b(?:it|this|that)(?:'s| is| was) not [^.;!?\n]{1,50}[.;,] (?:it|this|that)(?:'s| is| was)\b/gi,
  /\b(?:wasn't|isn't|was not|is not) [^.!?\n]{1,60}\. (?:It|This|That) (?:was|is)\b/g,
];

/** Matches of any pattern, counting overlapping matches (one contrast caught twice) once. */
function countSpans(text: string, patterns: RegExp[]): number {
  const spans = patterns
    .flatMap((re) => [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length] as const))
    .sort((a, b) => a[0] - b[0]);
  let count = 0;
  let end = -1;
  for (const [start, stop] of spans) {
    if (start < end) continue;
    count++;
    end = stop;
  }
  return count;
}

export function textMetrics(text: string): TextMetrics {
  const words = text.split(/\s+/).filter(Boolean).length;
  const dashes = (text.match(/\u2014|\u2013| -- /g) || []).length;
  const contrasts = countSpans(text, CONTRAST);
  const lengths = text
    .split(/(?<=[.!?]["'”’)]*)\s+|\n+/)
    .map((s) => s.split(/\s+/).filter(Boolean).length)
    .filter((n) => n > 0);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const spread = lengths.length
    ? Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length)
    : 0;
  return {
    words,
    dashesPer1k: words ? (dashes / words) * 1000 : 0,
    contrasts,
    meanSentence: mean,
    sentenceSpread: spread,
  };
}

// --- One arm ---------------------------------------------------------------------

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** What buildEditorContext would give the editor for this scene. */
export function sceneContext(scene: DemoScene): string {
  return `style.md:\n${scene.styleMd}\n${scene.bible}\n\nOPEN CHAPTER (last passage):\n${scene.continuity}`;
}

type Recorder = (model: string, res: Anthropic.Message) => void;

async function call(client: Client, req: Anthropic.MessageCreateParamsNonStreaming, record: Recorder) {
  const res = (await client.messages.create(req)) as Anthropic.Message;
  record(String(req.model), res);
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  return res;
}

async function runArm(client: Client, scene: DemoScene, arm: Arm, record: Recorder): Promise<ArmRun> {
  const craft = arm === "B";
  // The current pipeline has no em-dash switch: it always bans them.
  const emDashes = craft && emDashesAllowed(scene.styleMd);
  const draftRes = await call(
    client,
    {
      model: DRAFTER_MODEL,
      max_tokens: clamp(scene.wordTarget * 3, 800, 4000),
      system: drafterSystemFor(scene.kind, { emDashes, craft }),
      messages: [{ role: "user", content: beatDraftMessage(scene.brief, scene.continuity, false, scene.wordTarget) }],
    },
    record
  );
  const draft = textOf(draftRes);

  const findings = craft
    ? await checkDraft(draft, { kind: scene.kind, emDashes, brief: scene.brief, client: recording(client, record) })
    : [];
  const craftCheck = formatCraftCheck(findings);

  const editRes = await call(
    client,
    {
      model: EDITOR_MODEL,
      max_tokens: clamp(scene.wordTarget * 4, 1000, 5000),
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: editorSystemFor(scene.kind, AUTONOMOUS_DIRECTIVE, { craft }),
      messages: [
        {
          role: "user",
          content: `<context>\n${sceneContext(scene)}\n</context>\n\n${editBeatInstruction(scene.goal, draft, scene.continuity, craftCheck)}`,
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming,
    record
  );
  const final = textOf(editRes) || draft;

  // Annotate both arms' finals with the same check, so the page compares like with like.
  const finalFindings = await checkDraft(final, {
    kind: scene.kind,
    emDashes: emDashesAllowed(scene.styleMd),
    brief: scene.brief,
    client: recording(client, record),
  });
  return { draft, craftCheck, final, finalFindings, metrics: textMetrics(final) };
}

/** A client that records usage for calls made on its behalf (checkDraft's own call). */
function recording(client: Client, record: Recorder): Client {
  return {
    messages: {
      create: (async (req: Anthropic.MessageCreateParamsNonStreaming) => {
        const res = (await client.messages.create(req)) as Anthropic.Message;
        record(String(req.model), res);
        return res;
      }) as unknown as Client["messages"]["create"],
    } as Client["messages"],
  };
}

// --- Judge -----------------------------------------------------------------------

export const JUDGE_SYSTEM = `You are a demanding editor comparing two drafts of the same passage for an author. Both drafts answer the same brief and continue the same author's prose. Judge only the text in front of you.

Answer three questions separately:
- quality: which reads better as finished prose in this book - specific, alive, well paced, free of stock or mechanical writing?
- voice: which better sounds like the author of the continuity excerpt and follows their style.md?
- brief: which better does what the brief asks, including its do-NOT list and length?

For each, answer "1", "2", or "tie". Make a real choice; say tie only when you cannot separate them.
Reply with JSON only: {"quality":"1","voice":"2","brief":"tie","reason":"..."} where reason is one or two sentences naming the decisive difference. Never use em dashes; use a hyphen "-".`;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    quality: { type: "string", enum: ["1", "2", "tie"] },
    voice: { type: "string", enum: ["1", "2", "tie"] },
    brief: { type: "string", enum: ["1", "2", "tie"] },
    reason: { type: "string" },
  },
  required: ["quality", "voice", "brief", "reason"],
  additionalProperties: false,
} as const;

export function judgeRequest(scene: DemoScene, first: string, second: string): Anthropic.MessageCreateParamsNonStreaming {
  const content = `style.md:\n${scene.styleMd}\n\nThe brief:\n${scene.brief}\n\nThe author's prose the passage continues from:\n<continuity>\n${scene.continuity}\n</continuity>\n\n<passage_1>\n${first}\n</passage_1>\n\n<passage_2>\n${second}\n</passage_2>`;
  return {
    model: EDITOR_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content }],
  } as Anthropic.MessageCreateParamsNonStreaming;
}

function toArm(answer: unknown, firstShown: Arm): Verdict {
  if (answer === "1") return firstShown;
  if (answer === "2") return firstShown === "A" ? "B" : "A";
  return "tie";
}

async function judge(client: Client, scene: DemoScene, pair: PairRun, firstShown: Arm, record: Recorder): Promise<Judgment> {
  const [first, second] = firstShown === "A" ? [pair.A.final, pair.B.final] : [pair.B.final, pair.A.final];
  try {
    const res = await call(client, judgeRequest(scene, first, second), record);
    const parsed = JSON.parse(textOf(res)) as Record<string, unknown>;
    return {
      firstShown,
      quality: toArm(parsed.quality, firstShown),
      voice: toArm(parsed.voice, firstShown),
      brief: toArm(parsed.brief, firstShown),
      reason: String(parsed.reason || ""),
    };
  } catch (e) {
    return { firstShown, quality: "tie", voice: "tie", brief: "tie", reason: "", error: (e as Error).message };
  }
}

// --- The run ---------------------------------------------------------------------

async function pool<T>(items: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await items[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function failedArm(e: unknown): ArmRun {
  return {
    draft: "",
    craftCheck: "",
    final: "",
    finalFindings: [],
    metrics: textMetrics(""),
    error: (e as Error).message,
  };
}

export async function runDemo(opts: {
  client: Client;
  scenes: DemoScene[];
  samples: number;
  dryRun: boolean;
  concurrency?: number;
  /** Refuse new calls once spend reaches this many USD (calls already in flight still finish). */
  maxUsd?: number;
  onProgress?: (line: string) => void;
}): Promise<DemoResult> {
  const startedAt = new Date().toISOString();
  const usage: Usage[] = [];
  const record: Recorder = (model, res) => {
    usage.push({ model, input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 });
  };
  const { maxUsd } = opts;
  const client: Client = maxUsd
    ? {
        messages: {
          create: ((req: Anthropic.MessageCreateParamsNonStreaming) => {
            if (costOf(usage).total >= maxUsd) {
              return Promise.reject(new Error(`Stopped: spend reached the $${maxUsd} cap.`));
            }
            return opts.client.messages.create(req);
          }) as unknown as Client["messages"]["create"],
        } as Client["messages"],
      }
    : opts.client;
  const jobs = opts.scenes.flatMap((scene) =>
    Array.from({ length: opts.samples }, (_, sample) => async () => {
      const [A, B] = await Promise.all(
        (["A", "B"] as Arm[]).map((arm) => runArm(client, scene, arm, record).catch(failedArm))
      );
      const pair: PairRun = { sample: sample + 1, A, B, judgments: [] };
      if (!A.error && !B.error) {
        pair.judgments = await Promise.all(
          (["A", "B"] as Arm[]).map((first) => judge(client, scene, pair, first, record))
        );
      }
      opts.onProgress?.(`${scene.id} sample ${sample + 1} done`);
      return { sceneId: scene.id, pair };
    })
  );
  const done = await pool(jobs, opts.concurrency ?? 4);
  return {
    dryRun: opts.dryRun,
    startedAt,
    models: { drafter: DRAFTER_MODEL, editor: EDITOR_MODEL },
    samples: opts.samples,
    scenes: opts.scenes.map((scene) => ({
      scene,
      pairs: done.filter((d) => d.sceneId === scene.id).map((d) => d.pair),
    })),
    usage,
  };
}

// --- Summary and cost ------------------------------------------------------------

/** USD per million tokens (input, output). Thinking tokens bill as output. */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function costOf(usage: Usage[]): { total: number; byModel: Record<string, number>; unpriced: string[] } {
  const byModel: Record<string, number> = {};
  const unpriced = new Set<string>();
  for (const u of usage) {
    const price = PRICES[u.model];
    if (!price) {
      unpriced.add(u.model);
      continue;
    }
    byModel[u.model] = (byModel[u.model] ?? 0) + (u.input * price.input + u.output * price.output) / 1e6;
  }
  return { total: Object.values(byModel).reduce((a, b) => a + b, 0), byModel, unpriced: [...unpriced] };
}

export type Tally = { B: number; A: number; tie: number };

export function tally(result: DemoResult): Record<"quality" | "voice" | "brief", Tally> {
  const out = {
    quality: { A: 0, B: 0, tie: 0 },
    voice: { A: 0, B: 0, tie: 0 },
    brief: { A: 0, B: 0, tie: 0 },
  };
  for (const s of result.scenes)
    for (const p of s.pairs)
      for (const j of p.judgments) {
        if (j.error) continue;
        out.quality[j.quality]++;
        out.voice[j.voice]++;
        out.brief[j.brief]++;
      }
  return out;
}

export function averageMetrics(result: DemoResult, arm: Arm): TextMetrics & { flagged: number } {
  const runs = result.scenes.flatMap((s) => s.pairs.map((p) => p[arm])).filter((r) => !r.error);
  const n = runs.length || 1;
  const sum = (f: (r: ArmRun) => number) => runs.reduce((a, r) => a + f(r), 0) / n;
  return {
    words: sum((r) => r.metrics.words),
    dashesPer1k: sum((r) => r.metrics.dashesPer1k),
    contrasts: sum((r) => r.metrics.contrasts),
    meanSentence: sum((r) => r.metrics.meanSentence),
    sentenceSpread: sum((r) => r.metrics.sentenceSpread),
    flagged: sum((r) => r.finalFindings.length),
  };
}
