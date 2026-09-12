import type Anthropic from "@anthropic-ai/sdk";
import { authorizeOwnedChapter } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_FAST_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { CORRECT_SYSTEM } from "@/lib/prompts";
import { getUserSettings } from "@/lib/user-settings";

export type CorrectionSpan = {
  start: number;
  end: number;
  replacement: string;
};

export type CorrectRequest = {
  chapterId: string;
  blockId: string;
  text: string;
  revision: number;
};

export type CorrectResult = CorrectRequest & {
  spans: CorrectionSpan[];
};

function emptyResult(req: CorrectRequest): CorrectResult {
  return { ...req, spans: [] };
}

export function parseCorrectBody(body: unknown): CorrectRequest | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected a correction object." };
  }
  const src = body as Record<string, unknown>;
  const chapterId = typeof src.chapterId === "string" ? src.chapterId.trim() : "";
  const blockId = typeof src.blockId === "string" ? src.blockId.trim() : "";
  const text = typeof src.text === "string" ? src.text : "";
  const revision = src.revision;
  if (!chapterId) return { error: "chapterId required." };
  if (!blockId) return { error: "blockId required." };
  if (typeof revision !== "number" || !Number.isFinite(revision) || revision < 0) {
    return { error: "revision must be a number." };
  }
  return { chapterId, blockId, text, revision: Math.floor(revision) };
}

function extractJson(raw: string): unknown {
  const trimmed = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const object = trimmed.match(/\{[\s\S]*\}/);
    if (object) {
      try {
        return JSON.parse(object[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return null;
}

/** Keep only in-bounds, non-overlapping, actually-different replacements. */
export function parseCorrectionSpans(raw: string, text: string): CorrectionSpan[] {
  const parsed = extractJson(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as { spans?: unknown }).spans
      : null;
  if (!Array.isArray(list)) return [];
  const spans: CorrectionSpan[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const start = asInt(row.start);
    const end = asInt(row.end);
    const replacement = row.replacement;
    if (start == null || end == null || typeof replacement !== "string") continue;
    if (start < 0 || end > text.length || start >= end) continue;
    if (replacement === text.slice(start, end)) continue;
    if (spans.some((span) => start < span.end && end > span.start)) continue;
    spans.push({ start, end, replacement });
  }
  return spans.sort((a, b) => a.start - b.start);
}

async function askHaiku(text: string): Promise<string> {
  const anthropic = getAnthropic();
  const res = await anthropic.messages.create({
    model: DRAFTER_FAST_MODEL,
    max_tokens: 400,
    temperature: 0,
    system: CORRECT_SYSTEM,
    messages: [{ role: "user", content: text }],
  });
  return res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Spelling/grammar spans for one block. Fail-soft: settings off, missing key,
 * or a model failure all return an empty span list. Never writes an EditorRun.
 */
export async function correctBlock(user: PublicUser | null, body: unknown): Promise<CorrectResult> {
  if (!user) throw new AuthError("Authentication required.", 401);
  const parsed = parseCorrectBody(body);
  if ("error" in parsed) throw new AuthError(parsed.error, 400);
  await authorizeOwnedChapter(parsed.chapterId, user);

  const settings = await getUserSettings(user.id);
  if (!settings.autoCorrect || !parsed.text.trim() || !hasAnthropicKey()) {
    return emptyResult(parsed);
  }

  try {
    const raw = await askHaiku(parsed.text);
    return { ...parsed, spans: parseCorrectionSpans(raw, parsed.text) };
  } catch {
    return emptyResult(parsed);
  }
}
