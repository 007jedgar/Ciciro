import { StyleSheet } from "react-native";

export type ThemeId =
  | "parchment"
  | "sage"
  | "ember"
  | "walnut"
  | "inkwell"
  | "candle";

export type ColorTokens = {
  bg: string;
  panel: string;
  panel2: string;
  ink: string;
  inkSoft: string;
  line: string;
  accent: string;
  accentSoft: string;
  draft: string;
  danger: string;
};

export const THEME_META: { id: ThemeId; label: string; mode: "light" | "dark" }[] = [
  { id: "parchment", label: "Parchment", mode: "light" },
  { id: "sage", label: "Sage", mode: "light" },
  { id: "ember", label: "Ember", mode: "dark" },
  { id: "walnut", label: "Walnut", mode: "dark" },
  { id: "inkwell", label: "Inkwell", mode: "dark" },
  { id: "candle", label: "Candle", mode: "dark" },
];

export const THEME_PALETTES: Record<ThemeId, ColorTokens> = {
  parchment: {
    bg: "#f2ebe0",
    panel: "#faf6ef",
    panel2: "#ebe3d4",
    ink: "#2a2218",
    inkSoft: "#6e6354",
    line: "#d9cfbd",
    accent: "#b4552d",
    accentSoft: "#ecd9cc",
    draft: "#2f6b4f",
    danger: "#a83b3b",
  },
  sage: {
    bg: "#e8ebe3",
    panel: "#f4f6f1",
    panel2: "#dce3d8",
    ink: "#243028",
    inkSoft: "#5f6b60",
    line: "#c5d0c4",
    accent: "#6b7a4e",
    accentSoft: "#d7e0c8",
    draft: "#3a6e58",
    danger: "#a54a42",
  },
  ember: {
    bg: "#1a1713",
    panel: "#221e19",
    panel2: "#2c2620",
    ink: "#ece5d8",
    inkSoft: "#a99e8d",
    line: "#3a332b",
    accent: "#d9754a",
    accentSoft: "#3a2a20",
    draft: "#6fbf95",
    danger: "#e08080",
  },
  walnut: {
    bg: "#1c1410",
    panel: "#261c16",
    panel2: "#33261e",
    ink: "#f0e4d4",
    inkSoft: "#b29a82",
    line: "#463528",
    accent: "#c4a574",
    accentSoft: "#3a2e22",
    draft: "#8fbf8a",
    danger: "#d08a7a",
  },
  inkwell: {
    bg: "#121820",
    panel: "#18212c",
    panel2: "#222d3a",
    ink: "#e6e0d4",
    inkSoft: "#9aa3ad",
    line: "#2f3b4a",
    accent: "#c9a27a",
    accentSoft: "#2f2a24",
    draft: "#6db8a0",
    danger: "#d48888",
  },
  candle: {
    bg: "#14110e",
    panel: "#1d1813",
    panel2: "#2a221a",
    ink: "#f3e6cf",
    inkSoft: "#b8a078",
    line: "#3d3226",
    accent: "#e0a85c",
    accentSoft: "#3a2c18",
    draft: "#9bc47a",
    danger: "#e09078",
  },
};

export const fonts = {
  serif: "Georgia",
  sans: "System",
};

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEME_META.some((t) => t.id === value);
}

export function isDarkTheme(id: ThemeId): boolean {
  return THEME_META.find((t) => t.id === id)?.mode === "dark";
}

/** Default parchment tokens - used by tests and as a fallback. */
export const colors = THEME_PALETTES.parchment;

export function makeLayout(c: ColorTokens, editorFont: "serif" | "sans" = "serif") {
  const face = editorFont === "sans" ? fonts.sans : fonts.serif;
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.bg,
    },
    padded: {
      flex: 1,
      backgroundColor: c.bg,
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    title: {
      fontFamily: face,
      fontSize: 28,
      color: c.ink,
      marginBottom: 8,
    },
    body: {
      fontSize: 16,
      lineHeight: 24,
      color: c.inkSoft,
    },
    error: {
      color: c.danger,
      marginTop: 8,
      fontSize: 14,
    },
    input: {
      backgroundColor: c.panel,
      borderColor: c.line,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: c.ink,
      marginBottom: 12,
    },
    primaryBtn: {
      backgroundColor: c.accent,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 4,
    },
    primaryBtnText: {
      color: c.panel,
      fontSize: 16,
      fontWeight: "600",
    },
    ghostBtn: {
      paddingVertical: 14,
      alignItems: "center",
    },
    ghostBtnText: {
      color: c.accent,
      fontSize: 16,
    },
    card: {
      backgroundColor: c.panel,
      borderColor: c.line,
      borderWidth: 1,
      borderRadius: 10,
      padding: 16,
      marginBottom: 12,
    },
    cardTitle: {
      fontFamily: face,
      fontSize: 18,
      color: c.ink,
    },
    cardMeta: {
      marginTop: 4,
      color: c.inkSoft,
      fontSize: 13,
    },
  });
}

export const layout = makeLayout(colors);
