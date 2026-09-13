import {
  glassSheetGlowColors,
  pickSnapOffset,
  resolveGlassSnapHeights,
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
        snapPoints: [0.4, 0.9],
        windowHeight: 800,
        contentHeight: 0,
        maxHeight: 700,
      })
    ).toEqual([320, 700]);
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
});
