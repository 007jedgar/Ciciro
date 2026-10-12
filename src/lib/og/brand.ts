// Shared tokens for every link-preview image (Open Graph / Twitter card).
// Hex literals, not the CSS variables in src/app/globals.css - ImageResponse
// renders through Satori, which paints inline styles directly and never
// sees a stylesheet or `var()`. Colors are Archive (parchment), the
// marketing site's always-on theme regardless of a visitor's own setting.

export const OG_SIZE = { width: 1200, height: 630 } as const;

export const OG_COLORS = {
  paper: "#f1ede4",
  panel: "#fffdf7",
  ink: "#141414",
  inkSoft: "#5a574f",
  line: "#dad4c6",
  accent: "#2340e0",
  vermilion: "#e8442c",
} as const;
