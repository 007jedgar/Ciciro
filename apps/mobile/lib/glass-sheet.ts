export type GlassSnapPoint = number | "auto";

export const GLASS_SHEET_RADIUS = 36;
export const GLASS_SHEET_INSET = 10;
export const GLASS_SHEET_DISMISS_PX = 108;

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

export function glassSheetFillColors(dark: boolean): string[] {
  return dark ? ["#2c333ccc", "#1a1f26b8"] : ["#f7f9fbdc", "#e3ebf2c4"];
}
