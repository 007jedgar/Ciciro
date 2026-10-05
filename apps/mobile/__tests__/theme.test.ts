import {
  DEFAULT_THEME,
  fonts,
  isDarkTheme,
  isThemeId,
  THEME_META,
  THEME_PALETTES,
  type ColorTokens,
} from "../lib/theme";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TOKENS = Object.keys(THEME_PALETTES.ciciro) as (keyof ColorTokens)[];

describe("themes", () => {
  it("lists Ciciro and Ciciro Night first, then the original six", () => {
    expect(THEME_META.map((t) => [t.id, t.label, t.mode])).toEqual([
      ["ciciro", "Ciciro", "light"],
      ["ciciro-night", "Ciciro Night", "dark"],
      ["parchment", "Parchment", "light"],
      ["sage", "Marginalia", "light"],
      ["ember", "First Edition", "dark"],
      ["walnut", "Bookshelf", "dark"],
      ["inkwell", "Inkwell", "dark"],
      ["candle", "Dog-Ear", "dark"],
    ]);
  });

  it("renames only the labels: the ids people already stored still resolve", () => {
    for (const id of ["parchment", "sage", "ember", "walnut", "inkwell", "candle"]) {
      expect(isThemeId(id)).toBe(true);
      expect(THEME_PALETTES[id as keyof typeof THEME_PALETTES]).toBeDefined();
    }
    expect(isThemeId("marginalia")).toBe(false);
    expect(isThemeId("first-edition")).toBe(false);
  });

  it("defaults to Ciciro", () => {
    expect(DEFAULT_THEME).toBe("ciciro");
    expect(isDarkTheme("ciciro")).toBe(false);
    expect(isDarkTheme("ciciro-night")).toBe(true);
  });

  it("uses the web's Archive values for Ciciro and Ciciro Night", () => {
    expect(THEME_PALETTES.ciciro).toMatchObject({ bg: "#f1ede4", panel: "#fffdf7", accent: "#2340e0", ink: "#141414" });
    expect(THEME_PALETTES["ciciro-night"]).toMatchObject({ bg: "#121211", panel: "#1d1c19", accent: "#6b82ff" });
  });

  it("leaves the original palettes as they were", () => {
    expect(THEME_PALETTES.parchment).toMatchObject({ bg: "#f2ebe0", accent: "#b4552d" });
    expect(THEME_PALETTES.ember).toMatchObject({ bg: "#1a1713", accent: "#d9754a" });
  });

  it("gives every theme every token, including the paper stock", () => {
    for (const { id } of THEME_META) {
      for (const token of TOKENS) expect(THEME_PALETTES[id][token]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps the folder-tab band readable against the card, and its label against the band", () => {
    for (const { id } of THEME_META) {
      const c = THEME_PALETTES[id];
      expect(contrast(c.band, c.panel)).toBeGreaterThanOrEqual(1.7);
      expect(contrast(c.bandInk, c.band)).toBeGreaterThanOrEqual(7);
    }
  });

  it("keeps the manuscript face apart from the chrome faces", () => {
    expect(fonts.serif).toBe("Georgia");
    expect(fonts.display).not.toBe(fonts.serif);
  });
});
