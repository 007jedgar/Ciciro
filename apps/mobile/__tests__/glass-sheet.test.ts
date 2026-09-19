import {
  glassSheetFillColors,
  glassSheetGlowColors,
  mixHex,
  pickSnapOffset,
  resolveGlassSnapHeights,
  sheetHeightForContent,
  topRoundedPath,
} from "../lib/glass-sheet";

describe("glass sheet", () => {
  it("resolves auto snaps from measured content and clamps to the screen", () => {
    expect(
      resolveGlassSnapHeights({
        snapPoints: ["auto"],
        windowHeight: 800,
        contentHeight: 280,
        maxHeight: 700,
      })
    ).toEqual([280]);
    expect(
      resolveGlassSnapHeights({
        snapPoints: ["auto"],
        windowHeight: 800,
        contentHeight: 0,
        maxHeight: 700,
      })
    ).toEqual([700]);
    expect(
      resolveGlassSnapHeights({
        snapPoints: [0.4, 0.9],
        windowHeight: 800,
        contentHeight: 0,
        maxHeight: 700,
      })
    ).toEqual([320, 700]);
  });

  it("sizes an auto sheet to its body plus chrome, without clipping the last row", () => {
    expect(sheetHeightForContent(400, 34, 761)).toBe(458);
    expect(sheetHeightForContent(900, 34, 761)).toBe(761);
  });

  it("dismisses a drag past the smallest snap and otherwise snaps to the nearest rest", () => {
    expect(pickSnapOffset(0, [300, 500], 500, 0)).toBe(0);
    expect(pickSnapOffset(80, [300, 500], 500, 0)).toBe(0);
    expect(pickSnapOffset(250, [300, 500], 500, 0)).toBe(200);
    expect(pickSnapOffset(400, [300], 300, 0)).toBe("dismiss");
    expect(pickSnapOffset(20, [300], 300, 1_800)).toBe("dismiss");
  });

  it("keeps the accent in the glow loop so the border can hue-shift around it", () => {
    const glow = glassSheetGlowColors("#b4552d");
    expect(glow[0]).toBe("#b4552d");
    expect(glow[glow.length - 1]).toBe("#b4552d");
    expect(glow.length).toBeGreaterThan(3);
  });

  it("rounds only the top corners and runs the shape off the bottom", () => {
    const path = topRoundedPath(390, 300, 28, 72);
    expect(path.startsWith("M 0 372")).toBe(true);
    expect(path).toContain("A 28 28 0 0 1 28 0");
    expect(path).toContain("L 362 0");
    expect(path).toContain("L 390 372");
    const inset = topRoundedPath(390, 300, 27, 72, 1);
    expect(inset.startsWith("M 1 372")).toBe(true);
    expect(inset).toContain("L 389 372");
  });

  it("fills the pane nearly opaque so nothing behind it reads through", () => {
    for (const [dark, panel] of [
      [true, "#221e19"],
      [false, "#faf6ef"],
    ] as const) {
      const [top, bottom] = glassSheetFillColors(dark, panel);
      expect(top).toMatch(/^#[0-9a-f]{8}$/);
      expect(parseInt(top.slice(7), 16) / 255).toBeGreaterThan(0.9);
      expect(parseInt(bottom.slice(7), 16) / 255).toBeGreaterThan(0.95);
      // A visible wash: the top of the pane is lighter than its bottom.
      expect(parseInt(top.slice(1, 3), 16)).toBeGreaterThan(parseInt(bottom.slice(1, 3), 16));
    }
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
