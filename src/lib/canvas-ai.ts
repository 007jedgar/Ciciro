import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { withAiRun } from "@/lib/entitlements";
import {
  CANVAS_FILL_SYSTEM,
  CANVAS_OPTIONS_SYSTEM,
  CANVAS_OUTLINE_SYSTEM,
  PROSE_MAX_TOKENS,
} from "@/lib/prompts";
import { parseFillReply, parseOptionsReply, parseOutlineReply, type OutlineNode } from "@/lib/canvas-view";

// Metered JSON for the planning canvas. Nothing is written here: Fill and
// Options return text for the author to accept, and an outline returns the
// raw reply so accept can parse it again. A cut-off reply is discarded.

export type CanvasGenerateMode = "fill" | "options" | "outline";

export type CanvasGenerateResult =
  | { mode: "fill"; body: string }
  | { mode: "options"; options: string[] }
  | { mode: "outline"; raw: string; nodes: OutlineNode[] };

const SYSTEMS: Record<CanvasGenerateMode, string> = {
  fill: CANVAS_FILL_SYSTEM,
  options: CANVAS_OPTIONS_SYSTEM,
  outline: CANVAS_OUTLINE_SYSTEM,
};

function modelText(res: Anthropic.Message): string {
  return res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

async function ask(system: string, input: string): Promise<string> {
  const anthropic = getAnthropic();
  let res: Anthropic.Message;
  try {
    res = await anthropic.messages.create({
      model: DRAFTER_MODEL,
      max_tokens: PROSE_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: input }],
    });
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 429 || status === 529 || (typeof status === "number" && status >= 500)) {
      throw new AuthError("Ciciro is busy right now. Try the canvas again in a minute.", 503);
    }
    throw new AuthError("Ciciro couldn't reach its editor. Try the canvas again.", 502);
  }
  if (res.stop_reason === "max_tokens") {
    throw new AuthError("Ciciro's reply was cut off. Nothing was added to the board.", 502);
  }
  return modelText(res);
}

function clipBlock(title: string, body: string): string {
  const text = body.trim();
  return `## ${title || "Untitled"}\n${text ? text.slice(0, 2000) : "(empty)"}`;
}

async function cardPrompt(projectId: string, cardId: string): Promise<string> {
  const card = await prisma.canvasCard.findFirst({
    where: { id: cardId, projectId },
    select: { id: true, title: true, body: true, labels: { select: { label: { select: { name: true } } } } },
  });
  if (!card) throw new AuthError("Card not found.", 404);
  const edges = await prisma.canvasEdge.findMany({
    where: { projectId, OR: [{ fromId: cardId }, { toId: cardId }] },
    select: { fromId: true, toId: true },
  });
  const neighborIds = [...new Set(edges.flatMap((edge) => [edge.fromId, edge.toId]).filter((id) => id !== cardId))];
  const neighbors = neighborIds.length
    ? await prisma.canvasCard.findMany({
        where: { projectId, id: { in: neighborIds } },
        select: { title: true, body: true },
      })
    : [];
  const labels = card.labels.map((link) => link.label.name).filter(Boolean);
  return [
    "# Selected card",
    clipBlock(card.title, card.body),
    labels.length ? `Labels (the author's; do not create any): ${labels.join(", ")}` : "",
    "",
    "# Connected cards",
    neighbors.length ? neighbors.map((n) => clipBlock(n.title, n.body)).join("\n\n") : "(none)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** One metered pass. Does not write the board, the manuscript, or any label. */
export async function generateCanvas(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<CanvasGenerateResult> {
  await authorizeOwnedProject(projectId, user);
  if (!hasAnthropicKey()) throw new AuthError("Canvas needs an ANTHROPIC_API_KEY.", 503);
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const mode: CanvasGenerateMode | null =
    src.mode === "fill" || src.mode === "options" || src.mode === "outline" ? src.mode : null;
  const cardId = typeof src.cardId === "string" ? src.cardId : "";
  if (!mode || !cardId) throw new AuthError("Choose a card and what to generate.", 400);

  const input = await cardPrompt(projectId, cardId);
  const raw = await withAiRun(user, () => ask(SYSTEMS[mode], input));
  if (mode === "fill") {
    const text = parseFillReply(raw);
    if (!text) throw new AuthError("Ciciro's reply couldn't be read. The card was not changed.", 502);
    return { mode, body: text };
  }
  if (mode === "options") {
    const options = parseOptionsReply(raw);
    if (!options) throw new AuthError("Ciciro's reply couldn't be read. The card was not changed.", 502);
    return { mode, options };
  }
  const nodes = parseOutlineReply(raw);
  if (!nodes) throw new AuthError("Ciciro's reply couldn't be read. No cards were added.", 502);
  return { mode, raw, nodes };
}
