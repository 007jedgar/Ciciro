/**
 * Colour maths for the places that need a neighbouring hue rather than a second
 * hand-picked token. The palettes are authored as hex; a sweep that lights up
 * in more than one colour should still belong to whichever theme is on, so it
 * turns the theme's own accent rather than reaching for a fixed rainbow.
 */

function clamp01(value: number): number {
  "worklet";
  return Math.max(0, Math.min(1, value));
}

/** `#rgb` or `#rrggbb` to 0..1 channels. Anything unparseable comes back black. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.slice(0, 6);
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.round(clamp01(value) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Hue in turns (0..1), saturation and lightness 0..1. */
export function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): {
  h: number;
  s: number;
  l: number;
} {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const span = max - min;
  if (span === 0) return { h: 0, s: 0, l };
  const s = span / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / span) % 6;
  else if (max === g) h = (b - r) / span + 2;
  else h = (r - g) / span + 4;
  h /= 6;
  return { h: ((h % 1) + 1) % 1, s: clamp01(s), l };
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): {
  r: number;
  g: number;
  b: number;
} {
  const hue = ((h % 1) + 1) % 1;
  const c = (1 - Math.abs(2 * l - 1)) * clamp01(s);
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(hue * 6) % 6;
  const [r, g, b] =
    sector === 0
      ? [c, x, 0]
      : sector === 1
        ? [x, c, 0]
        : sector === 2
          ? [0, c, x]
          : sector === 3
            ? [0, x, c]
            : sector === 4
              ? [x, 0, c]
              : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}

/**
 * The same colour turned around the wheel. `degrees` is signed; `lift` nudges
 * lightness so a rotated accent stays as readable as the one it came from on a
 * dark panel, where a straight rotation can land somewhere muddy.
 */
export function rotateHue(hex: string, degrees: number, lift = 0): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(
    hslToRgb({
      h: hsl.h + degrees / 360,
      s: hsl.s,
      l: clamp01(hsl.l + lift),
    })
  );
}
