import type Anthropic from "@anthropic-ai/sdk";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_FAST_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { aiAllowed } from "@/lib/entitlements";
import { SYNONYMS_SYSTEM } from "@/lib/prompts";
import { SYNONYM_LIMIT, synonymEligible, type SynonymContext } from "@/lib/selection-menu";

export type SynonymsResult = { synonyms: string[] };

const MAX_CONTEXT = 400;

/** Only a real word with a little of its sentence reaches the model. */
export function parseSynonymsBody(body: unknown): SynonymContext | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected a synonyms request." };
  }
  const src = body as Record<string, unknown>;
  const word = typeof src.word === "string" ? src.word.trim() : "";
  if (!synonymEligible(word)) return { error: "word must be a single word." };
  const clip = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_CONTEXT) : "");
  return { word, before: clip(src.before), after: clip(src.after) };
}

function extractJson(raw: string): unknown {
  const trimmed = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const object = trimmed.match(/\{[\s\S]*\}/);
    if (!object) return null;
    try {
      return JSON.parse(object[0]);
    } catch {
      return null;
    }
  }
}

/**
 * The model's replacements as a clean list: short, deduplicated, never the
 * word itself, best fit first. Anything that is not a plain word or phrase is
 * dropped rather than fixed up.
 */
export function parseSynonyms(raw: string, word: string): string[] {
  const parsed = extractJson(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as { synonyms?: unknown }).synonyms
      : null;
  if (!Array.isArray(list)) return [];
  const own = word.toLowerCase();
  const seen = new Set<string>([own]);
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const text = item.trim().replace(/\s+/g, " ");
    if (!text || text.length > 32 || text.split(" ").length > 2) continue;
    if (!/^\p{L}[\p{L}'’ -]*$/u.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === SYNONYM_LIMIT) break;
  }
  return out;
}

async function askHaiku(context: SynonymContext): Promise<string> {
  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: DRAFTER_FAST_MODEL,
    max_tokens: 300,
    temperature: 0,
    system: SYNONYMS_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Before: ${context.before}\nWord: ${context.word}\nAfter: ${context.after}`,
      },
    ],
  });
  return res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Synonyms for one word in its sentence. Like spelling help they are background
 * work, so free of the monthly allowance and quietly empty once it is used up.
 * Fail-soft: a missing key or a model failure returns no synonyms. Never writes
 * an EditorRun.
 */
export async function synonymsFor(user: PublicUser | null, body: unknown): Promise<SynonymsResult> {
  if (!user) throw new AuthError("Authentication required.", 401);
  const parsed = parseSynonymsBody(body);
  if ("error" in parsed) throw new AuthError(parsed.error, 400);
  if (!hasAnthropicKey() || !(await aiAllowed(user))) return { synonyms: [] };
  try {
    return { synonyms: parseSynonyms(await askHaiku(parsed), parsed.word) };
  } catch {
    return { synonyms: [] };
  }
}
