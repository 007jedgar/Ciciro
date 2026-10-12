export type ThemeName = "day" | "night";

export interface Palette {
  bg: string;
  panel: string;
  ink: string;
  inkSoft: string;
  line: string;
  vermilion: string;
  bandInk: string;
  marginRule: string;
}

// Mirrors the `--bg` / `--panel` / `--ink` / `--vermilion` tokens in
// src/app/globals.css (`:root` for day, `[data-theme="ember"]` for night).
export const palettes: Record<ThemeName, Palette> = {
  day: {
    bg: "#f1ede4",
    panel: "#fffdf7",
    ink: "#141414",
    inkSoft: "#5a574f",
    line: "#dad4c6",
    vermilion: "#e8442c",
    bandInk: "#f3efe6",
    marginRule: "rgba(232, 68, 44, 0.45)",
  },
  night: {
    bg: "#121211",
    panel: "#1d1c19",
    ink: "#ede8dc",
    inkSoft: "#a39d90",
    line: "#34322d",
    vermilion: "#ff5a40",
    bandInk: "#f3efe6",
    marginRule: "rgba(255, 90, 64, 0.45)",
  },
};
