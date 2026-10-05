import type Anthropic from "@anthropic-ai/sdk";
import { authorizeOwnedChapter } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_FAST_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { aiAllowed } from "@/lib/entitlements";
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

/** Curly quotes read as straight ones, one UTF-16 unit for one, so offsets carry over. */
function foldQuotes(value: string): string {
  return value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function isBlank(value: string): boolean {
  return value.trim() === "";
}

/**
 * Shrink a quoted fix to what it changes. Whole words (and the spaces between
 * them) that the original and replacement share at either end were only there
 * to make the quote unique, and whitespace at the edges of a word fix is never
 * part of it: "I'dd " -> "I'd" must not take the space before the next word.
 */
function narrowFix(
  original: string,
  replacement: string
): { lead: number; trail: number; replacement: string } {
  const from = original.split(/(\s+)/).filter(Boolean);
  const to = replacement.split(/(\s+)/).filter(Boolean);
  let head = 0;
  while (head < from.length - 1 && head < to.length && from[head] === to[head]) head++;
  let tail = 0;
  while (
    head + tail < from.length - 1 &&
    head + tail < to.length &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  ) {
    tail++;
  }
  let lead = from.slice(0, head).join("").length;
  let trail = from.slice(from.length - tail).join("").length;
  let next = to.slice(head, to.length - tail).join("");
  const core = original.slice(lead, original.length - trail);
  // A deletion ("the the" -> "the") takes one space with the word, or it
  // would leave two behind.
  if (!isBlank(core) && !isBlank(next)) {
    lead += core.length - core.trimStart().length;
    trail += core.length - core.trimEnd().length;
    next = next.trim();
  }
  return { lead, trail, replacement: next };
}

/**
 * Turn the model's quoted fixes into spans over `text`. Offsets are found
 * here, never taken from the model: each quote must appear in the block
 * (curly and straight quotes match each other), searched in reading order.
 * Keeps only non-overlapping, actually-different replacements.
 */
export function parseCorrectionSpans(raw: string, text: string): CorrectionSpan[] {
  const parsed = extractJson(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? ((parsed as { fixes?: unknown }).fixes ?? (parsed as { spans?: unknown }).spans)
      : null;
  if (!Array.isArray(list)) return [];
  const folded = foldQuotes(text);
  const spans: CorrectionSpan[] = [];
  let cursor = 0;
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const original = row.original;
    if (typeof original !== "string" || !original || typeof row.replacement !== "string") continue;
    const needle = foldQuotes(original);
    let at = folded.indexOf(needle, cursor);
    if (at === -1) at = folded.indexOf(needle);
    if (at === -1) continue;
    const fix = narrowFix(original, row.replacement);
    const start = at + fix.lead;
    const end = at + original.length - fix.trail;
    if (start >= end) continue;
    const current = text.slice(start, end);
    // Keep the writer's apostrophes: a fix to "I’dd" stays curly.
    const replacement =
      current.includes("’") && !current.includes("'")
        ? fix.replacement.replace(/'/g, "’")
        : fix.replacement;
    if (replacement === current) continue;
    if (spans.some((span) => start < span.end && end > span.start)) continue;
    spans.push({ start, end, replacement });
    cursor = at + original.length;
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
  // Spelling is background help: free of the monthly allowance, off once it is used up.
  if (!settings.autoCorrect || !parsed.text.trim() || !hasAnthropicKey() || !(await aiAllowed(user))) {
    return emptyResult(parsed);
  }

  try {
    const raw = await askHaiku(parsed.text);
    return { ...parsed, spans: parseCorrectionSpans(raw, parsed.text) };
  } catch {
    return emptyResult(parsed);
  }
}
