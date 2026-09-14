export type GlassSnapPoint = number | "auto";

export const GLASS_SHEET_RADIUS = 28;
export const GLASS_SHEET_DISMISS_PX = 108;
/** How far the Skia shape runs past the sheet so its bottom edge never shows. */
export const GLASS_SHEET_BLEED = 72;

export function resolveGlassSnapHeights({
  snapPoints,
  windowHeight,
  contentHeight,
  maxHeight,
}: {
  snapPoints: GlassSnapPoint[];
  windowHeight: number;
  contentHeight: number;
  maxHeight: number;
}): number[] {
  const points = snapPoints.length > 0 ? snapPoints : (["auto"] as GlassSnapPoint[]);
  const heights = points.map((point) => {
    if (point === "auto") {
      const measured = contentHeight > 0 ? contentHeight : Math.round(windowHeight * 0.42);
      return Math.min(Math.max(measured, 160), maxHeight);
    }
    return Math.min(Math.max(point * windowHeight, 160), maxHeight);
  });
  return [...new Set(heights.map((h) => Math.round(h)))].sort((a, b) => a - b);
}

export function restOffset(sheetHeight: number, snapHeight: number): number {
  "worklet";
  return Math.max(0, sheetHeight - snapHeight);
}

export function pickSnapOffset(
  offset: number,
  snaps: number[],
  sheetHeight: number,
  velocityY: number
): number | "dismiss" {
  "worklet";
  const smallest = snaps[0] ?? sheetHeight;
  if (offset > restOffset(sheetHeight, smallest) + GLASS_SHEET_DISMISS_PX || velocityY > 1_350) {
    return "dismiss";
  }
  let best = restOffset(sheetHeight, snaps[snaps.length - 1] ?? sheetHeight);
  let bestDist = Number.POSITIVE_INFINITY;
  for (const height of snaps) {
    const y = restOffset(sheetHeight, height);
    const dist = Math.abs(y - offset);
    if (dist < bestDist) {
      best = y;
      bestDist = dist;
    }
  }
  return best;
}

/** Iridescent stops that orbit the sheet's accent. */
export function glassSheetGlowColors(accent: string): string[] {
  return [accent, "#5eead4", "#7dd3fc", "#c4b5fd", "#fb7185", "#fbbf24", accent];
}

/** Blend two 6-digit hex colors. `amount` is how much of `target` to take. */
export function mixHex(hex: string, target: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const read = (value: string, at: number) => parseInt(value.slice(at, at + 2), 16);
  const out = [0, 2, 4].map((at) => {
    const blended = Math.round(read(hex.slice(1), at) * (1 - t) + read(target.slice(1), at) * t);
    return Math.max(0, Math.min(255, blended)).toString(16).padStart(2, "0");
  });
  return `#${out.join("")}`;
}

function withAlpha(hex: string, a: number): string {
  const clamped = Math.max(0, Math.min(1, a));
  return hex + Math.round(clamped * 255).toString(16).padStart(2, "0");
}

/**
 * Sandblasted glass: near-opaque so nothing behind reads through, with a light
 * top falling to a deep bottom so the pane still looks lit from the screen.
 */
export function glassSheetFillColors(dark: boolean, base?: string): string[] {
  const panel = base ?? (dark ? "#20262e" : "#f6f8fb");
  const top = mixHex(panel, "#ffffff", dark ? 0.2 : 0.62);
  const bottom = mixHex(panel, "#000000", dark ? 0.42 : 0.1);
  return [withAlpha(top, dark ? 0.93 : 0.95), withAlpha(bottom, dark ? 0.99 : 0.99)];
}

/**
 * A rect rounded on top only, run `bleed` past the sheet bottom so neither the
 * fill nor the glow stroke ever draws a bottom edge on screen. `inset` pulls the
 * edges in so a stroked copy stays inside the canvas instead of being half-clipped.
 */
export function topRoundedPath(
  width: number,
  height: number,
  radius: number,
  bleed = GLASS_SHEET_BLEED,
  inset = 0
): string {
  const i = Math.max(0, Math.round(inset));
  const left = i;
  const top = i;
  const right = Math.max(left, Math.round(width) - i);
  const bottom = Math.max(top, Math.round(height + bleed));
  const r = Math.max(0, Math.min(Math.round(radius), Math.floor((right - left) / 2), bottom - top));
  return [
    `M ${left} ${bottom}`,
    `L ${left} ${top + r}`,
    `A ${r} ${r} 0 0 1 ${left + r} ${top}`,
    `L ${right - r} ${top}`,
    `A ${r} ${r} 0 0 1 ${right} ${top + r}`,
    `L ${right} ${bottom}`,
    "Z",
  ].join(" ");
}
