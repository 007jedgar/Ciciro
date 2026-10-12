import React from "react";

// Mirrors the badge drawn by scripts/generate-brand-icons.mjs (ring + three
// dots) so the notification's app icon matches the real BrandMark.
export const BrandMark: React.FC<{ size: number; bg: string; ring: string; dot: string }> = ({
  size,
  bg,
  ring,
  dot,
}) => (
  <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: "block", borderRadius: size * 0.22 }}>
    <rect width={48} height={48} fill={bg} />
    <circle cx={24} cy={24} r={18} fill="none" stroke={ring} strokeWidth={3} />
    <circle cx={14.5} cy={24} r={3.4} fill={dot} />
    <circle cx={24} cy={24} r={3.4} fill={dot} />
    <circle cx={33.5} cy={24} r={3.4} fill={dot} />
  </svg>
);
