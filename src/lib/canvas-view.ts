// Pure helpers for the planning canvas: caps, label colors, and the JSON the
// drafter returns for Fill, Options, and Generate full outline. A reply that
// does not parse — including a truncated one — produces no cards and no body.

import { parseJsonReply } from "@/lib/state-review-view";

export const CANVAS_CARDS_MAX = 200;
export const CANVAS_LABELS_MAX = 40;
export const CANVAS_TITLE_MAX = 160;
export const CANVAS_BODY_MAX = 4000;
export const CANVAS_LABEL_NAME_MAX = 40;
export const CANVAS_OUTLINE_NODES_MAX = 24;

export const CANVAS_LABEL_COLORS = ["accent", "ink", "olive", "wine", "sea", "gold"] as const;
export type CanvasLabelColor = (typeof CANVAS_LABEL_COLORS)[number];

export const CANVAS_CARD_WIDTH = 240;
export const CANVAS_CARD_GAP_X = 36;
export const CANVAS_ROW_HEIGHT = 200;

export function canvasLabelColor(value: unknown): CanvasLabelColor | null {
  if (typeof value !== "string") return null;
  return (CANVAS_LABEL_COLORS as readonly string[]).includes(value) ? (value as CanvasLabelColor) : null;
}

export type OutlineNode = {
  title: string;
  body: string;
  children: OutlineNode[];
};

export type PlacedOutlineCard = {
  key: string;
  title: string;
  body: string;
  x: number;
  y: number;
  /** Null means the premise card is the parent. */
  parentKey: string | null;
};

const OUTLINE_DEPTH_MAX = 6;

function asOutlineNode(raw: unknown, depth: number, budget: { n: number }): OutlineNode | null {
  if (!raw || typeof raw !== "object" || depth > OUTLINE_DEPTH_MAX || budget.n >= CANVAS_OUTLINE_NODES_MAX) {
    return null;
  }
  const src = raw as Record<string, unknown>;
  const title = typeof src.title === "string" ? src.title.trim().slice(0, CANVAS_TITLE_MAX) : "";
  const body = typeof src.body === "string" ? src.body.trim().slice(0, CANVAS_BODY_MAX) : "";
  if (!title) return null;
  budget.n += 1;
  const children: OutlineNode[] = [];
  if (Array.isArray(src.children)) {
    for (const child of src.children) {
      const node = asOutlineNode(child, depth + 1, budget);
      if (node) children.push(node);
    }
  }
  return { title, body, children };
}

function nodesFrom(parsed: unknown): OutlineNode[] | null {
  if (parsed == null) return null;
  const budget = { n: 0 };
  if (Array.isArray(parsed)) {
    const nodes = parsed.map((item) => asOutlineNode(item, 0, budget)).filter((n): n is OutlineNode => n !== null);
    return nodes.length ? nodes : null;
  }
  if (typeof parsed !== "object") return null;
  const src = parsed as Record<string, unknown>;
  if (Array.isArray(src.nodes)) {
    const nodes = src.nodes.map((item) => asOutlineNode(item, 0, budget)).filter((n): n is OutlineNode => n !== null);
    return nodes.length ? nodes : null;
  }
  const one = asOutlineNode(parsed, 0, budget);
  return one ? [one] : null;
}

/**
 * The outline that hangs under the premise. Null for empty, non-JSON, or
 * truncated JSON, so the caller creates no cards.
 */
export function parseOutlineReply(raw: string): OutlineNode[] | null {
  if (!raw || !raw.trim()) return null;
  return nodesFrom(parseJsonReply(raw));
}

export function parseFillReply(raw: string): string | null {
  const parsed = parseJsonReply(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = (parsed as Record<string, unknown>).body;
  if (typeof body !== "string") return null;
  const text = body.trim().slice(0, CANVAS_BODY_MAX);
  return text ? text : null;
}

export function parseOptionsReply(raw: string): string[] | null {
  const parsed = parseJsonReply(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const options = (parsed as Record<string, unknown>).options;
  if (!Array.isArray(options)) return null;
  const bodies = options
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, CANVAS_BODY_MAX))
    .filter(Boolean);
  if (bodies.length < 3) return null;
  return bodies.slice(0, 3);
}

function subtreeWidth(node: OutlineNode): number {
  if (!node.children.length) return 1;
  return node.children.reduce((sum, child) => sum + subtreeWidth(child), 0);
}

/**
 * Lay a tree of new cards under the premise. The premise itself is not copied.
 * x grows to the right of the premise; each depth steps down one row.
 */
export function placeOutline(nodes: OutlineNode[], origin: { x: number; y: number }): PlacedOutlineCard[] {
  const placed: PlacedOutlineCard[] = [];
  const stride = CANVAS_CARD_WIDTH + CANVAS_CARD_GAP_X;

  function place(node: OutlineNode, left: number, depth: number, parentKey: string | null) {
    const width = subtreeWidth(node);
    const key = `n${placed.length}`;
    placed.push({
      key,
      title: node.title,
      body: node.body,
      x: origin.x + (left + width / 2) * stride - CANVAS_CARD_WIDTH / 2,
      y: origin.y + (depth + 1) * CANVAS_ROW_HEIGHT,
      parentKey,
    });
    let cursor = left;
    for (const child of node.children) {
      const childWidth = subtreeWidth(child);
      place(child, cursor, depth + 1, key);
      cursor += childWidth;
    }
  }

  let left = 0;
  for (const node of nodes) {
    const width = subtreeWidth(node);
    place(node, left, 0, null);
    left += width;
  }
  return placed;
}

export function curveBetween(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max(48, Math.abs(to.x - from.x) * 0.45);
  const sign = to.x >= from.x ? 1 : -1;
  return `M ${from.x} ${from.y} C ${from.x + dx * sign} ${from.y}, ${to.x - dx * sign} ${to.y}, ${to.x} ${to.y}`;
}
