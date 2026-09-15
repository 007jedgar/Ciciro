import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, rotateHue } from "../lib/color";

describe("hexToRgb", () => {
  it("reads both shorthand and full hex", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("b4552d").r).toBeCloseTo(180 / 255);
  });

  it("falls back to black rather than NaN channels", () => {
    expect(hexToRgb("not a colour")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#12")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("rgbToHsl / hslToRgb", () => {
  it("round-trips the theme accents", () => {
    for (const hex of ["#b4552d", "#6b7a4e", "#d9754a", "#c4a574", "#e0a85c"]) {
      expect(rgbToHex(hslToRgb(rgbToHsl(hexToRgb(hex))))).toBe(hex);
    }
  });

  it("leaves greys unsaturated", () => {
    expect(rgbToHsl(hexToRgb("#808080")).s).toBe(0);
  });
});

describe("rotateHue", () => {
  it("moves the hue by the angle asked for and keeps it on the wheel", () => {
    const from = rgbToHsl(hexToRgb("#b4552d")).h;
    const to = rgbToHsl(hexToRgb(rotateHue("#b4552d", 44))).h;
    expect(((to - from + 1) % 1) * 360).toBeCloseTo(44, 0);
    // Past the end of the wheel it wraps rather than clipping.
    expect(rotateHue("#b4552d", 360)).toBe("#b4552d");
  });

  it("lifts lightness when asked, and never past white", () => {
    expect(rgbToHsl(hexToRgb(rotateHue("#b4552d", 0, 0.1))).l).toBeGreaterThan(
      rgbToHsl(hexToRgb("#b4552d")).l
    );
    expect(rotateHue("#b4552d", 0, 5)).toBe("#ffffff");
  });
});
