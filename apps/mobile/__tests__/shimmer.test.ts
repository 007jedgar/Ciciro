import { hexToRgb, rgbToHsl } from "../lib/color";
import {
  SHIMMER_SPREAD_DEG,
  SHIMMER_TAIL,
  shimmerBrightness,
  shimmerHead,
  shimmerLit,
  shimmerPalette,
  shimmerPosition,
} from "../lib/shimmer";

describe("shimmerHead", () => {
  it("enters from before the first character and leaves past the last", () => {
    expect(shimmerHead(0)).toBeCloseTo(-SHIMMER_TAIL);
    expect(shimmerHead(1)).toBeCloseTo(-SHIMMER_TAIL);
    expect(shimmerHead(0.99999)).toBeCloseTo(1 + SHIMMER_TAIL, 3);
  });

  it("wraps, so a repeating clock never runs the crest off the end", () => {
    expect(shimmerHead(2.5)).toBeCloseTo(shimmerHead(0.5));
    expect(shimmerHead(-0.5)).toBeCloseTo(shimmerHead(0.5));
  });
});

describe("shimmerPosition", () => {
  it("spreads characters from 0 to 1 and parks a lone character at the start", () => {
    expect(shimmerPosition(0, 5)).toBe(0);
    expect(shimmerPosition(4, 5)).toBe(1);
    expect(shimmerPosition(0, 1)).toBe(0);
  });
});

describe("shimmerBrightness", () => {
  it("rests at zero everywhere outside the lit band", () => {
    // Crest is off the left edge at the start of a cycle.
    expect(shimmerBrightness(0, 8, 9)).toBe(0);
    expect(shimmerBrightness(0.999, 0, 9)).toBe(0);
  });

  it("peaks on the character the crest is passing", () => {
    // Mid-cycle the crest sits at the middle of the string.
    const mid = shimmerBrightness(0.5, 4, 9);
    expect(mid).toBeGreaterThan(0.95);
    expect(shimmerBrightness(0.5, 0, 9)).toBeLessThan(mid);
    expect(shimmerBrightness(0.5, 8, 9)).toBeLessThan(mid);
  });

  it("travels left to right as the clock advances", () => {
    const first = 0;
    const last = 8;
    // Early on, the left of the string is the brighter end; late on, the right.
    expect(shimmerBrightness(0.2, first, 9)).toBeGreaterThan(
      shimmerBrightness(0.2, last, 9)
    );
    expect(shimmerBrightness(0.8, last, 9)).toBeGreaterThan(
      shimmerBrightness(0.8, first, 9)
    );
  });

  it("stays within 0..1 across a whole cycle", () => {
    for (let tick = 0; tick <= 1; tick += 0.02) {
      for (let index = 0; index < 9; index++) {
        const value = shimmerBrightness(tick, index, 9);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("shimmerPalette", () => {
  const palette = shimmerPalette("#b4552d", "#2f6b4f");

  it("spreads four distinct colours around the theme's own accent", () => {
    expect(palette).toHaveLength(4);
    expect(new Set(palette).size).toBe(4);
    expect(palette[0]).toBe("#b4552d");
    expect(palette[2]).toBe("#2f6b4f");
  });

  it("stays in the theme: the turned colours sit either side of the accent", () => {
    const hue = (hex: string) => rgbToHsl(hexToRgb(hex)).h * 360;
    // Signed distance the short way round, so an accent near 0° reads as
    // -44° rather than +316°.
    const apart = (a: number, b: number) => ((a - b + 540) % 360) - 180;
    const accent = hue("#b4552d");
    expect(apart(hue(palette[1]!), accent)).toBeCloseTo(SHIMMER_SPREAD_DEG, 0);
    expect(apart(hue(palette[3]!), accent)).toBeCloseTo(-SHIMMER_SPREAD_DEG, 0);
  });
});

describe("shimmerLit", () => {
  it("lights a whole run in one colour when given one", () => {
    expect(shimmerLit("#b4552d", 0)).toBe("#b4552d");
    expect(shimmerLit("#b4552d", 7)).toBe("#b4552d");
  });

  it("deals a palette out along the string so neighbours differ", () => {
    const palette = ["#a", "#b", "#c"];
    expect(shimmerLit(palette, 0)).toBe("#a");
    expect(shimmerLit(palette, 1)).toBe("#b");
    expect(shimmerLit(palette, 3)).toBe("#a");
    expect(shimmerLit(palette, 0)).not.toBe(shimmerLit(palette, 1));
  });

  it("has an answer for an empty palette rather than an undefined colour", () => {
    expect(shimmerLit([], 2)).toBe("#000000");
  });
});
