// The post-draft craft check. After the drafter returns a passage, and before
// the editor edits it, this finds the craft-default habits
// (src/lib/craft-defaults.ts) the passage still has, each tied to a verbatim
// quote. The findings go to the editor only (appended to the dispatch_draft
// tool result, or to the auto-draft beat's edit instruction): the editor fixes
// them or keeps them on purpose, and the author never sees the list. It never
// edits prose itself.
//
// Two layers:
//  - Mechanical checks, free and certain: em dashes when style.md keeps them off,
//    and runs of sentences that open on the same word.
//  - One bounded DRAFTER_MODEL call for the habits that need judgment (a stated
//    theme, a mood mirrored by the weather). Every quote it returns must be an
//    exact substring of the passage, or the finding is dropped: a model can
//    paraphrase despite being told not to.
// It never throws. With no key, a model failure, or the fast drafter, the
// mechanical findings still come back.

import type Anthropic from "@anthropic-ai/sdk";
import { DRAFTER_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { craftHabitsFor } from "@/lib/craft-defaults";
import type { ManuscriptKind } from "@/lib/manuscript-kind";
import { proseCheckSystemFor } from "@/lib/prompts";

export type CraftFinding = {
  /** Exact substring of the checked passage. */
  quote: string;
  /** A habit name from craft-defaults.ts, or a mechanical check's name. */
  habit: string;
  note: string;
};

export const CRAFT_FINDINGS_MAX = 8;
const MODEL_FINDINGS_MAX = 6;
const QUOTE_MAX = 240;

// --- Mechanical checks ----------------------------------------------------------

const DASH = /\u2014|\u2013| -- /;

type Sentence = { text: string; start: number };

/** Sentences of one paragraph, with their offsets into the whole passage. */
function sentencesOf(paragraph: string, offset: number): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?]+(?:[.!?]+["'”’)]*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) out.push({ text, start: offset + m.index + lead });
  }
  return out;
}

function paragraphsOf(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /[^\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].trim()) out.push({ text: m[0], start: m.index });
  }
  return out;
}

function clip(quote: string): string {
  return quote.length <= QUOTE_MAX ? quote : quote.slice(0, QUOTE_MAX);
}

/** Sentences that use an em or en dash (or a spaced double hyphen standing in for one). */
export function findDashes(text: string, limit = 3): CraftFinding[] {
  const out: CraftFinding[] = [];
  for (const p of paragraphsOf(text)) {
    for (const s of sentencesOf(p.text, p.start)) {
      if (!DASH.test(s.text)) continue;
      out.push({
        quote: clip(s.text),
        habit: "em dash",
        note: 'Em dashes are off for this manuscript: use a hyphen "-", a comma, a colon, or a period.',
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const OPENING_QUOTE = /^["'“‘(]/;

function firstWord(sentence: string): string {
  return (sentence.match(/^[A-Za-z']+/)?.[0] || "").toLowerCase();
}

/**
 * Three or more narration sentences in a row, inside one paragraph, that open
 * on the same word. Dialogue is skipped: a character may talk that way.
 */
export function findRepeatedOpenings(text: string, limit = 2): CraftFinding[] {
  const out: CraftFinding[] = [];
  for (const p of paragraphsOf(text)) {
    const sentences = sentencesOf(p.text, p.start).filter((s) => !OPENING_QUOTE.test(s.text));
    let i = 0;
    while (i < sentences.length) {
      const word = firstWord(sentences[i].text);
      let j = i + 1;
      while (word && j < sentences.length && firstWord(sentences[j].text) === word) j++;
      if (word && j - i >= 3) {
        const first = sentences[i];
        const last = sentences[j - 1];
        const span = text.slice(first.start, last.start + last.text.length);
        out.push({
          quote: clip(span.length <= QUOTE_MAX ? span : first.text),
          habit: "repeated openings",
          note: `${j - i} sentences in a row open with "${first.text.match(/^[A-Za-z']+/)?.[0]}": merge some, or open on the action.`,
        });
        if (out.length >= limit) return out;
      }
      i = j;
    }
  }
  return out;
}

/** The mechanical findings for a passage. Screenplay lines are elements, not sentences, so only dashes apply. */
export function mechanicalFindings(
  text: string,
  { kind, emDashes }: { kind: ManuscriptKind; emDashes: boolean }
): CraftFinding[] {
  const dashes = emDashes ? [] : findDashes(text);
  const openings = kind === "screenplay" ? [] : findRepeatedOpenings(text);
  return [...dashes, ...openings];
}

// --- Model check ----------------------------------------------------------------

function normalizeFinding(raw: unknown, text: string, names: Set<string>): CraftFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const quote = typeof src.quote === "string" ? src.quote.trim() : "";
  const habit = typeof src.habit === "string" ? src.habit.trim().toLowerCase() : "";
  const note = typeof src.note === "string" ? src.note.trim() : "";
  if (!quote || !note || !names.has(habit)) return null;
  if (!text.includes(quote)) return null;
  return { quote: clip(quote), habit, note };
}

/** Parse the model's reply, keeping only findings whose quote is really in the passage. */
export function parseCraftFindings(raw: string, text: string, kind: ManuscriptKind): CraftFinding[] {
  const names = new Set(craftHabitsFor(kind).map((h) => h.name));
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
  } catch {
    return [];
  }
  const list = (parsed as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(list)) return [];
  return list
    .map((f) => normalizeFinding(f, text, names))
    .filter((f): f is CraftFinding => f !== null)
    .slice(0, MODEL_FINDINGS_MAX);
}

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          habit: { type: "string" },
          note: { type: "string" },
        },
        required: ["quote", "habit", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
} as const;

/** The request the model check sends. Exported for the demo's cost estimate and for tests. */
export function craftCheckRequest(
  text: string,
  kind: ManuscriptKind,
  brief = ""
): Anthropic.MessageCreateParamsNonStreaming | null {
  const system = proseCheckSystemFor(kind);
  if (!system) return null;
  const content = `${brief ? `The brief the passage was written from:\n<brief>\n${brief}\n</brief>\n\n` : ""}The passage to check:\n<passage>\n${text}\n</passage>`;
  return {
    model: DRAFTER_MODEL,
    max_tokens: 1500,
    system,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: FINDINGS_SCHEMA },
    },
    messages: [{ role: "user", content }],
  } as Anthropic.MessageCreateParamsNonStreaming;
}

async function modelFindings(
  text: string,
  kind: ManuscriptKind,
  brief: string,
  client: Pick<Anthropic, "messages">
): Promise<CraftFinding[]> {
  const request = craftCheckRequest(text, kind, brief);
  if (!request) return [];
  try {
    const res = await client.messages.create(request);
    const reply = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return parseCraftFindings(reply, text, kind);
  } catch {
    return [];
  }
}

export type CraftCheckOptions = {
  kind: ManuscriptKind;
  /** The author's style.md switch (emDashesAllowed); off by default. */
  emDashes: boolean;
  /** The brief the passage answers, so the check can tell a requested choice from a habit. */
  brief?: string;
  /** false skips the model call (the fast drafter, or no key). */
  model?: boolean;
  /** Injected by the demo; production uses getAnthropic(). */
  client?: Pick<Anthropic, "messages">;
};

/** Check one drafted passage. Model findings first (they carry judgment), then mechanical ones. */
export async function checkDraft(text: string, opts: CraftCheckOptions): Promise<CraftFinding[]> {
  if (!text.trim()) return [];
  const mechanical = mechanicalFindings(text, opts);
  let fromModel: CraftFinding[] = [];
  const wantModel = opts.model !== false && (opts.client || hasAnthropicKey());
  if (wantModel) {
    let client = opts.client;
    if (!client) {
      try {
        client = getAnthropic();
      } catch {
        client = undefined;
      }
    }
    if (client) fromModel = await modelFindings(text, opts.kind, opts.brief || "", client);
  }
  const seen = new Set<string>();
  const out: CraftFinding[] = [];
  for (const f of [...fromModel, ...mechanical]) {
    const key = `${f.habit}\u0000${f.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out.slice(0, CRAFT_FINDINGS_MAX);
}

/** The block the editor reads after a draft, or "" when there is nothing to report. */
export function formatCraftCheck(findings: CraftFinding[]): string {
  if (!findings.length) return "";
  const lines = findings.map((f) => `- [${f.habit}] "${f.quote}" - ${f.note}`);
  return `CRAFT CHECK (fix each in your edit, or keep it when it is the author's voice or the brief asked for it):\n${lines.join("\n")}`;
}
