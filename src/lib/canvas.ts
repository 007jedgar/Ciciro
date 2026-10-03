import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import {
  CANVAS_BODY_MAX,
  CANVAS_CARDS_MAX,
  CANVAS_LABEL_NAME_MAX,
  CANVAS_LABELS_MAX,
  CANVAS_TITLE_MAX,
  canvasLabelColor,
  parseOutlineReply,
  placeOutline,
  type CanvasLabelColor,
} from "@/lib/canvas-view";

// The planning canvas. Cards, labels, and arrows belong to the project.
// Generated outline text is written only by createOutlineFromReply, and only
// after the reply parses. A bad or truncated reply creates nothing.

export type CanvasLabelView = { id: string; name: string; color: CanvasLabelColor };
export type CanvasCardView = {
  id: string;
  title: string;
  body: string;
  x: number;
  y: number;
  labelIds: string[];
};
export type CanvasEdgeView = { id: string; fromId: string; toId: string };
export type CanvasBoardView = {
  labels: CanvasLabelView[];
  cards: CanvasCardView[];
  edges: CanvasEdgeView[];
};

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clip(value: unknown, max: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max);
}

async function requireCard(projectId: string, cardId: string) {
  const card = await prisma.canvasCard.findFirst({
    where: { id: cardId, projectId },
    select: { id: true, title: true, body: true, x: true, y: true },
  });
  if (!card) throw new AuthError("Card not found.", 404);
  return card;
}

export async function getCanvasBoard(projectId: string, user: PublicUser | null): Promise<CanvasBoardView> {
  await authorizeOwnedProject(projectId, user);
  const [labels, cards, edges] = await Promise.all([
    prisma.canvasLabel.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
    prisma.canvasCard.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, body: true, x: true, y: true, labels: { select: { labelId: true } } },
    }),
    prisma.canvasEdge.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true, fromId: true, toId: true },
    }),
  ]);
  return {
    labels: labels.flatMap((label) => {
      const color = canvasLabelColor(label.color);
      return color ? [{ id: label.id, name: label.name, color }] : [];
    }),
    cards: cards.map((card) => ({
      id: card.id,
      title: card.title,
      body: card.body,
      x: card.x,
      y: card.y,
      labelIds: card.labels.map((link) => link.labelId),
    })),
    edges,
  };
}

export async function createCanvasCard(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<CanvasCardView> {
  await authorizeOwnedProject(projectId, user);
  const count = await prisma.canvasCard.count({ where: { projectId } });
  if (count >= CANVAS_CARDS_MAX) {
    throw new AuthError(`The board holds ${CANVAS_CARDS_MAX} cards. Remove one to add another.`, 400);
  }
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const created = await prisma.canvasCard.create({
    data: {
      projectId,
      title: clip(src.title, CANVAS_TITLE_MAX, "Untitled"),
      body: clip(src.body, CANVAS_BODY_MAX),
      x: num(src.x, 80 + (count % 6) * 28),
      y: num(src.y, 80 + (count % 6) * 24),
    },
  });
  return { id: created.id, title: created.title, body: created.body, x: created.x, y: created.y, labelIds: [] };
}

export async function updateCanvasCard(
  projectId: string,
  user: PublicUser | null,
  cardId: string,
  body: unknown
): Promise<CanvasCardView> {
  await authorizeOwnedProject(projectId, user);
  await requireCard(projectId, cardId);
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const data: { title?: string; body?: string; x?: number; y?: number } = {};
  if ("title" in src) data.title = clip(src.title, CANVAS_TITLE_MAX);
  if ("body" in src) data.body = clip(src.body, CANVAS_BODY_MAX);
  if ("x" in src) data.x = num(src.x, 0);
  if ("y" in src) data.y = num(src.y, 0);
  if (Object.keys(data).length) {
    await prisma.canvasCard.update({ where: { id: cardId }, data });
  }
  if ("labelIds" in src) {
    const ids = Array.isArray(src.labelIds) ? src.labelIds.filter((id): id is string => typeof id === "string") : [];
    const owned = await prisma.canvasLabel.findMany({
      where: { projectId, id: { in: ids } },
      select: { id: true },
    });
    const allowed = new Set(owned.map((label) => label.id));
    await prisma.canvasCardLabel.deleteMany({ where: { cardId } });
    const next = ids.filter((id) => allowed.has(id));
    if (next.length) {
      await prisma.canvasCardLabel.createMany({
        data: next.map((labelId) => ({ cardId, labelId })),
      });
    }
  }
  const card = await prisma.canvasCard.findFirstOrThrow({
    where: { id: cardId },
    select: { id: true, title: true, body: true, x: true, y: true, labels: { select: { labelId: true } } },
  });
  return {
    id: card.id,
    title: card.title,
    body: card.body,
    x: card.x,
    y: card.y,
    labelIds: card.labels.map((link) => link.labelId),
  };
}

export async function deleteCanvasCard(
  projectId: string,
  user: PublicUser | null,
  cardId: string
): Promise<void> {
  await authorizeOwnedProject(projectId, user);
  await requireCard(projectId, cardId);
  await prisma.canvasCard.delete({ where: { id: cardId } });
}

export async function createCanvasLabel(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<CanvasLabelView> {
  await authorizeOwnedProject(projectId, user);
  const count = await prisma.canvasLabel.count({ where: { projectId } });
  if (count >= CANVAS_LABELS_MAX) {
    throw new AuthError(`The board holds ${CANVAS_LABELS_MAX} labels. Remove one to add another.`, 400);
  }
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const name = clip(src.name, CANVAS_LABEL_NAME_MAX);
  if (!name) throw new AuthError("Name the label first.", 400);
  const color = canvasLabelColor(src.color) ?? "accent";
  try {
    const created = await prisma.canvasLabel.create({ data: { projectId, name, color } });
    return { id: created.id, name: created.name, color };
  } catch {
    throw new AuthError("That label already exists.", 409);
  }
}

export async function deleteCanvasLabel(
  projectId: string,
  user: PublicUser | null,
  labelId: string
): Promise<void> {
  await authorizeOwnedProject(projectId, user);
  const label = await prisma.canvasLabel.findFirst({ where: { id: labelId, projectId }, select: { id: true } });
  if (!label) throw new AuthError("Label not found.", 404);
  await prisma.canvasLabel.delete({ where: { id: labelId } });
}

export async function createCanvasEdge(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<CanvasEdgeView> {
  await authorizeOwnedProject(projectId, user);
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const fromId = typeof src.fromId === "string" ? src.fromId : "";
  const toId = typeof src.toId === "string" ? src.toId : "";
  if (!fromId || !toId || fromId === toId) throw new AuthError("Connect two different cards.", 400);
  await requireCard(projectId, fromId);
  await requireCard(projectId, toId);
  const existing = await prisma.canvasEdge.findUnique({
    where: { fromId_toId: { fromId, toId } },
    select: { id: true, fromId: true, toId: true },
  });
  if (existing) return existing;
  const created = await prisma.canvasEdge.create({ data: { projectId, fromId, toId } });
  return { id: created.id, fromId: created.fromId, toId: created.toId };
}

export async function deleteCanvasEdge(
  projectId: string,
  user: PublicUser | null,
  edgeId: string
): Promise<void> {
  await authorizeOwnedProject(projectId, user);
  const edge = await prisma.canvasEdge.findFirst({ where: { id: edgeId, projectId }, select: { id: true } });
  if (!edge) throw new AuthError("Arrow not found.", 404);
  await prisma.canvasEdge.delete({ where: { id: edgeId } });
}

/**
 * Turn a model outline into cards and arrows under the premise. Invalid or
 * truncated JSON creates nothing and does not throw.
 */
export async function createOutlineFromReply(
  projectId: string,
  user: PublicUser | null,
  cardId: string,
  raw: string
): Promise<{ created: number; cardIds: string[] }> {
  await authorizeOwnedProject(projectId, user);
  const nodes = parseOutlineReply(raw);
  if (!nodes) return { created: 0, cardIds: [] };
  const premise = await requireCard(projectId, cardId);
  const placed = placeOutline(nodes, { x: premise.x, y: premise.y });
  if (!placed.length) return { created: 0, cardIds: [] };
  const existing = await prisma.canvasCard.count({ where: { projectId } });
  if (existing + placed.length > CANVAS_CARDS_MAX) {
    throw new AuthError(
      `That outline needs ${placed.length} cards and the board holds ${CANVAS_CARDS_MAX}. Nothing was added.`,
      400
    );
  }
  // One batch: D1 cannot run an interactive transaction, and a second batch
  // for the arrows would leave the cards behind if it failed.
  const ids = placed.map(() => crypto.randomUUID());
  const idByKey = new Map(placed.map((card, index) => [card.key, ids[index]!]));
  await prisma.$transaction([
    ...placed.map((card, index) =>
      prisma.canvasCard.create({
        data: {
          id: ids[index],
          projectId,
          title: card.title,
          body: card.body,
          x: card.x,
          y: card.y,
        },
      })
    ),
    ...placed.map((card) => {
      const toId = idByKey.get(card.key)!;
      const fromId = card.parentKey ? idByKey.get(card.parentKey)! : premise.id;
      return prisma.canvasEdge.create({ data: { projectId, fromId, toId } });
    }),
  ]);
  return { created: placed.length, cardIds: ids };
}
