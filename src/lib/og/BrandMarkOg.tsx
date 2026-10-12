import { OG_COLORS } from "@/lib/og/brand";

/**
 * The ellipsis seal (src/components/BrandMark.tsx) redrawn for Satori, which
 * does not resolve `currentColor` or CSS variables, so the ring and dots are
 * explicit hex instead of `currentColor` / `var(--vermilion)`.
 */
export default function BrandMarkOg({ size = 48, ring = OG_COLORS.ink }: { size?: number; ring?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="22.5" fill="none" stroke={ring} strokeWidth="2" />
      <circle cx="14.5" cy="24" r="3.6" fill={OG_COLORS.vermilion} />
      <circle cx="24" cy="24" r="3.6" fill={OG_COLORS.vermilion} />
      <circle cx="33.5" cy="24" r="3.6" fill={OG_COLORS.vermilion} />
    </svg>
  );
}
