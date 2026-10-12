import {
  CANVAS_CARD_WIDTH,
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  canvasBounds,
  canvasHref,
  canvasLabelColor,
  canvasLabelFixedHex,
  cardHeight,
  cardPort,
  clampCanvasScale,
  curveBetween,
  fitCanvasView,
  type CanvasCard,
} from "../lib/canvas";

function card(id: string, x: number, y: number): CanvasCard {
  return { id, title: `Card ${id}`, body: "", x, y, labelIds: [] };
}

describe("canvasLabelColor", () => {
  it("accepts every known color", () => {
    for (const color of ["accent", "ink", "olive", "wine", "sea", "gold"]) {
      expect(canvasLabelColor(color)).toBe(color);
    }
  });

  it("rejects anything else", () => {
    expect(canvasLabelColor("purple")).toBeNull();
    expect(canvasLabelColor(42)).toBeNull();
    expect(canvasLabelColor(undefined)).toBeNull();
  });
});

describe("canvasLabelFixedHex", () => {
  it("gives a fixed swatch for the four non-theme colors", () => {
    expect(canvasLabelFixedHex("olive")).toBe("#5f6b45");
    expect(canvasLabelFixedHex("wine")).toBe("#7a3b45");
    expect(canvasLabelFixedHex("sea")).toBe("#3d5c66");
    expect(canvasLabelFixedHex("gold")).toBe("#8a6a32");
  });

  it("leaves accent and ink to the theme", () => {
    expect(canvasLabelFixedHex("accent")).toBeNull();
    expect(canvasLabelFixedHex("ink")).toBeNull();
  });
});

describe("curveBetween", () => {
  it("draws a cubic curve starting and ending at the given ports", () => {
    const d = curveBetween({ x: 0, y: 0 }, { x: 300, y: 50 });
    expect(d.startsWith("M 0 0 C")).toBe(true);
    expect(d.endsWith("300 50")).toBe(true);
  });

  it("bends the other way when the arrow points left", () => {
    expect(curveBetween({ x: 0, y: 0 }, { x: 300, y: 0 })).toBe("M 0 0 C 135 0, 165 0, 300 0");
    expect(curveBetween({ x: 300, y: 0 }, { x: 0, y: 0 })).toBe("M 300 0 C 165 0, 135 0, 0 0");
  });
});

describe("cardHeight / cardPort", () => {
  it("falls back to a default height when nothing was measured yet", () => {
    expect(cardHeight({}, "a")).toBeGreaterThan(0);
    expect(cardHeight({ a: 200 }, "a")).toBe(200);
  });

  it("puts the right port at the card's right edge, vertically centered", () => {
    const port = cardPort({ x: 10, y: 20 }, 100, "right");
    expect(port).toEqual({ x: 10 + CANVAS_CARD_WIDTH, y: 70 });
  });

  it("puts the left port at the card's left edge", () => {
    const port = cardPort({ x: 10, y: 20 }, 100, "left");
    expect(port).toEqual({ x: 10, y: 70 });
  });
});

describe("canvasBounds", () => {
  it("gives a default box for an empty board", () => {
    expect(canvasBounds([], {})).toEqual({ minX: 0, minY: 0, maxX: CANVAS_CARD_WIDTH, maxY: 140 });
  });

  it("covers every card at its measured height", () => {
    const cards = [card("a", 0, 0), card("b", 400, 100)];
    const bounds = canvasBounds(cards, { a: 150, b: 90 });
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(400 + CANVAS_CARD_WIDTH);
    expect(bounds.maxY).toBe(190);
  });
});

describe("clampCanvasScale", () => {
  it("clamps to the min and max", () => {
    expect(clampCanvasScale(0)).toBe(CANVAS_MIN_SCALE);
    expect(clampCanvasScale(100)).toBe(CANVAS_MAX_SCALE);
    expect(clampCanvasScale(1)).toBe(1);
  });

  it("falls back to 1 for a non-finite scale", () => {
    expect(clampCanvasScale(Number.NaN)).toBe(1);
    expect(clampCanvasScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("fitCanvasView", () => {
  it("centers a single card in the viewport at scale 1 when it already fits", () => {
    const bounds = { minX: 0, minY: 0, maxX: CANVAS_CARD_WIDTH, maxY: 140 };
    const view = fitCanvasView(bounds, 800, 600, 0);
    expect(view.scale).toBe(1);
    expect(view.x).toBeCloseTo(800 / 2 - CANVAS_CARD_WIDTH / 2);
    expect(view.y).toBeCloseTo(600 / 2 - 70);
  });

  it("shrinks to fit content wider than the viewport, clamped to the minimum zoom", () => {
    const bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 140 };
    const view = fitCanvasView(bounds, 400, 800, 0);
    // 400 / 4000 = 0.1, below CANVAS_MIN_SCALE, so the fit clamps to the floor.
    expect(view.scale).toBe(CANVAS_MIN_SCALE);
  });

  it("shrinks to fit content moderately wider than the viewport", () => {
    const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 140 };
    const view = fitCanvasView(bounds, 500, 800, 0);
    expect(view.scale).toBeCloseTo(0.5);
  });

  it("never scales up past 1 just because the viewport is huge", () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    const view = fitCanvasView(bounds, 4000, 4000, 0);
    expect(view.scale).toBe(1);
  });

  it("falls back to scale 1 with no measured viewport", () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    expect(fitCanvasView(bounds, 0, 0)).toEqual({ x: 48, y: 48, scale: 1 });
  });
});

describe("canvasHref", () => {
  it("builds the canvas route for a project", () => {
    expect(canvasHref("proj-1")).toBe("/project/proj-1/canvas");
  });
});
