import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, DRAFTER_FAST_MODEL } from "@/lib/anthropic";
import { COMPACT_SYSTEM } from "@/lib/prompts";

// Fast / cheap lane for non-editorial jobs.
//
// Constraints (enforced here, not only in docs):
//  - Continuity compaction is Haiku-only. Never Groq.
//  - Ranking/suggestions may use Groq when GROQ_API_KEY is set; otherwise Haiku.
//  - Ranker output is advisory only - the editor (Opus) decides what to expand
//    via its own tool calls. Nothing here gatekeeps retrieval.

export const ROUTER_MODEL =
  process.env.CICIRO_ROUTER_MODEL || "llama-3.1-8b-instant";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export type RankCandidate = {
  id: string;
  label: string;
  score?: number;
  reason?: string;
};

export type RankResult = {
  ranked: RankCandidate[];
  source: "groq" | "haiku" | "none";
};

function groqKey(): string | undefined {
  const k = process.env.GROQ_API_KEY?.trim();
  return k || undefined;
}

async function groqJson(
  system: string,
  user: string
): Promise<string | null> {
  const key = groqKey();
  if (!key) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ROUTER_MODEL,
        temperature: 0,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

async function haikuText(system: string, user: string): Promise<string> {
  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: DRAFTER_FAST_MODEL,
    max_tokens: 600,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Rank candidate past turns / blobs for relevance. Advisory only - never used
 * to hide or skip retrieval the editor can perform itself.
 */
export async function runRanker(
  query: string,
  candidates: { id: string; label: string; preview?: string }[]
): Promise<RankResult> {
  if (!candidates.length) return { ranked: [], source: "none" };

  const system = `You rank archive candidates for a novel editor AI.
Return JSON: {"ranked":[{"id":"...","score":0-1,"reason":"short"}]}
Rank by relevance to the query. Include every id. Do not invent ids.
This ranking is a HINT only - the editor will decide what to open.`;

  const user = `Query:\n${query}\n\nCandidates:\n${candidates
    .map((c) => `- ${c.id}: ${c.label}${c.preview ? ` — ${c.preview.slice(0, 160)}` : ""}`)
    .join("\n")}`;

  const parse = (raw: string): RankCandidate[] => {
    try {
      const j = JSON.parse(raw) as { ranked?: RankCandidate[] };
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const out: RankCandidate[] = [];
      for (const r of j.ranked || []) {
        const base = byId.get(r.id);
        if (!base) continue;
        out.push({
          id: r.id,
          label: base.label,
          score: typeof r.score === "number" ? r.score : undefined,
          reason: r.reason,
        });
      }
      // Append any missing ids so the editor still sees the full set.
      for (const c of candidates) {
        if (!out.some((x) => x.id === c.id)) {
          out.push({ id: c.id, label: c.label });
        }
      }
      return out;
    } catch {
      return candidates.map((c) => ({ id: c.id, label: c.label }));
    }
  };

  const fromGroq = await groqJson(system, user);
  if (fromGroq) return { ranked: parse(fromGroq), source: "groq" };

  try {
    const fromHaiku = await haikuText(
      system + "\nReply with JSON only.",
      user
    );
    // Strip optional markdown fences.
    const raw = fromHaiku.replace(/^```json\s*|\s*```$/g, "").trim();
    return { ranked: parse(raw), source: "haiku" };
  } catch {
    return {
      ranked: candidates.map((c) => ({ id: c.id, label: c.label })),
      source: "none",
    };
  }
}

/**
 * Continuity brief for older chat. Haiku only - never Groq.
 * Thin wrapper around the same COMPACT_SYSTEM used by compact.ts.
 */
export async function runContinuityCompact(transcript: string): Promise<string> {
  return haikuText(COMPACT_SYSTEM, transcript);
}
