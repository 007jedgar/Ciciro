// Pure data shapes and layout math for viewing the project canvas (cards,
// labels, arrows) read-only on the phone. This intentionally mirrors only the
// rendering-relevant subset of src/lib/canvas-view.ts (label colors, card
// width, the arrow curve) — not the outline-generation reply parsers, which
// pull in the drafter/chat parsing stack and stay web/server only, since
// mobile has no card creation or Ciciro generation in this first pass. See
// AGENTS.md's "Project canvas (mobile)" entry.

export const CANVAS_LABEL_COLORS = ["accent", "ink", "olive", "wine", "sea", "gold"] as const;
export type CanvasLabelColor = (typeof CANVAS_LABEL_COLORS)[number];

export function canvasLabelColor(value: unknown): CanvasLabelColor | null {
  if (typeof value !== "string") return null;
  return (CANVAS_LABEL_COLORS as readonly string[]).includes(value) ? (value as CanvasLabelColor) : null;
}

export type CanvasLabel = { id: string; name: string; color: CanvasLabelColor };
export type CanvasCard = { id: string; title: string; body: string; x: number; y: number; labelIds: string[] };
export type CanvasEdge = { id: string; fromId: string; toId: string };
export type CanvasBoard = { labels: CanvasLabel[]; cards: CanvasCard[]; edges: CanvasEdge[] };

/** Matches CANVAS_CARD_WIDTH in src/lib/canvas-view.ts: the world holds one card layout. */
export const CANVAS_CARD_WIDTH = 240;
const DEFAULT_CARD_HEIGHT = 140;

/** Same curve the web canvas draws between two card ports. */
export function curveBetween(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max(48, Math.abs(to.x - from.x) * 0.45);
  const sign = to.x >= from.x ? 1 : -1;
  return `M ${from.x} ${from.y} C ${from.x + dx * sign} ${from.y}, ${to.x - dx * sign} ${to.y}, ${to.x} ${to.y}`;
}

export function cardHeight(heights: Readonly<Record<string, number>>, cardId: string): number {
  return heights[cardId] ?? DEFAULT_CARD_HEIGHT;
}

/** The point an arrow leaves from or lands on: a card's left or right edge, vertically centered. */
export function cardPort(
  card: { x: number; y: number },
  height: number,
  side: "left" | "right"
): { x: number; y: number } {
  return { x: card.x + (side === "right" ? CANVAS_CARD_WIDTH : 0), y: card.y + height / 2 };
}

export type CanvasBounds = { minX: number; minY: number; maxX: number; maxY: number };

/** The content box every card sits in, so the board can open already framed. An empty board is one card-sized box at the origin. */
export function canvasBounds(
  cards: readonly CanvasCard[],
  heights: Readonly<Record<string, number>>
): CanvasBounds {
  if (!cards.length) return { minX: 0, minY: 0, maxX: CANVAS_CARD_WIDTH, maxY: DEFAULT_CARD_HEIGHT };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const card of cards) {
    const height = cardHeight(heights, card.id);
    minX = Math.min(minX, card.x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + CANVAS_CARD_WIDTH);
    maxY = Math.max(maxY, card.y + height);
  }
  return { minX, minY, maxX, maxY };
}

export const CANVAS_MIN_SCALE = 0.25;
export const CANVAS_MAX_SCALE = 2.5;

/**
 * Worklet-tagged: the pinch gesture on the canvas screen calls this from a
 * Reanimated UI-thread callback. A plain function imported from another
 * module and called inside one needs its own "worklet" directive, or it
 * crashes every animation (see AGENTS.md's "Mobile motion").
 */
export function clampCanvasScale(scale: number): number {
  "worklet";
  if (!Number.isFinite(scale)) return 1;
  return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, scale));
}

export type CanvasView = { x: number; y: number; scale: number };

/**
 * The pan/zoom that frames the board's content inside a viewport of the given
 * size, so opening the canvas never starts on empty space. Falls back to
 * scale 1, centered, if the viewport has no size yet.
 */
export function fitCanvasView(
  bounds: CanvasBounds,
  viewportWidth: number,
  viewportHeight: number,
  margin = 48
): CanvasView {
  if (viewportWidth <= 0 || viewportHeight <= 0) return { x: margin, y: margin, scale: 1 };
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clampCanvasScale(
    Math.min((viewportWidth - margin * 2) / contentWidth, (viewportHeight - margin * 2) / contentHeight, 1)
  );
  const x = viewportWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const y = viewportHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * scale;
  return { x, y, scale };
}

export function canvasHref(projectId: string): string {
  return `/project/${projectId}/canvas`;
}

/** Fixed hex for the four non-theme label colors; matches .canvas-chip[data-color] in globals.css. */
const FIXED_LABEL_HEX: Partial<Record<CanvasLabelColor, string>> = {
  olive: "#5f6b45",
  wine: "#7a3b45",
  sea: "#3d5c66",
  gold: "#8a6a32",
};

/** A label chip's background: the fixed swatch softened, or the theme's own ink/accent tint. */
export function canvasLabelFixedHex(color: CanvasLabelColor): string | null {
  return FIXED_LABEL_HEX[color] ?? null;
}
