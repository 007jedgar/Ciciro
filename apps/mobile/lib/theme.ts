import { Platform, StyleSheet } from "react-native";

export type ThemeId =
  | "ciciro"
  | "ciciro-night"
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
  /** Outline of a text field: 3:1 against the surfaces it sits on (WCAG 1.4.11), unlike the hairline `line`. */
  field: string;
  accent: string;
  accentSoft: string;
  draft: string;
  danger: string;
  /** Archive paper stock, shared by every theme. Text on these is always ink. */
  vermilion: string;
  blush: string;
  butter: string;
  /** Ink for text printed on the stock above in every theme. */
  paperInk: string;
  /** The ink band behind folder tabs; lighter in dark themes so it reads against the card. */
  band: string;
  bandInk: string;
  /** Text and fill that sit on the accent. */
  onAccent: string;
};

const STOCK_LIGHT = {
  paperInk: "#141414",
  vermilion: "#e8442c",
  blush: "#f5aca2",
  butter: "#ffd84d",
  band: "#141414",
  bandInk: "#f3efe6",
} as const;
const STOCK_DARK = {
  paperInk: "#141414",
  vermilion: "#ff5a40",
  blush: "#d98a82",
  butter: "#f2c94c",
  band: "#504d45",
  bandInk: "#f3efe6",
} as const;

/**
 * The picker's order and display names. The stored ids never change, so an
 * author who picked a theme before a rename keeps it: "sage" is shown as
 * Marginalia, "ember" as First Edition, "walnut" as Bookshelf, "candle" as
 * Dog-Ear. "ciciro" and "ciciro-night" are the Archive look of the website.
 */
export const THEME_META: { id: ThemeId; label: string; mode: "light" | "dark" }[] = [
  { id: "ciciro", label: "Ciciro", mode: "light" },
  { id: "ciciro-night", label: "Ciciro Night", mode: "dark" },
  { id: "parchment", label: "Parchment", mode: "light" },
  { id: "sage", label: "Marginalia", mode: "light" },
  { id: "ember", label: "First Edition", mode: "dark" },
  { id: "walnut", label: "Bookshelf", mode: "dark" },
  { id: "inkwell", label: "Inkwell", mode: "dark" },
  { id: "candle", label: "Dog-Ear", mode: "dark" },
];

/** What a person who never picked a theme sees. */
export const DEFAULT_THEME: ThemeId = "ciciro";

export const THEME_PALETTES: Record<ThemeId, ColorTokens> = {
  ciciro: {
    bg: "#f1ede4",
    panel: "#fffdf7",
    panel2: "#e9e4d8",
    ink: "#141414",
    inkSoft: "#5a574f",
    line: "#dad4c6",
    field: "#86827a",
    accent: "#2340e0",
    accentSoft: "#dfe4fb",
    draft: "#127458",
    danger: "#bc3426",
    ...STOCK_LIGHT,
    onAccent: "#ffffff",
  },
  "ciciro-night": {
    bg: "#121211",
    panel: "#1d1c19",
    panel2: "#26241f",
    ink: "#ede8dc",
    inkSoft: "#a39d90",
    line: "#34322d",
    field: "#6f6d6a",
    accent: "#6d84ff",
    accentSoft: "#1f2547",
    draft: "#6fbf95",
    danger: "#ff7a68",
    ...STOCK_DARK,
    onAccent: "#121211",
  },
  parchment: {
    bg: "#f2ebe0",
    panel: "#faf6ef",
    panel2: "#ebe3d4",
    ink: "#2a2218",
    inkSoft: "#6a6051",
    line: "#d9cfbd",
    field: "#888176",
    accent: "#9b4927",
    accentSoft: "#ecd9cc",
    draft: "#2f6b4f",
    danger: "#a83b3b",
    ...STOCK_LIGHT,
    onAccent: "#ffffff",
  },
  sage: {
    bg: "#e8ebe3",
    panel: "#f4f6f1",
    panel2: "#dce3d8",
    ink: "#243028",
    inkSoft: "#59645a",
    line: "#c5d0c4",
    field: "#7b827a",
    accent: "#5a6642",
    accentSoft: "#d7e0c8",
    draft: "#396b56",
    danger: "#9d473f",
    ...STOCK_LIGHT,
    onAccent: "#ffffff",
  },
  ember: {
    bg: "#1a1713",
    panel: "#221e19",
    panel2: "#2c2620",
    ink: "#ece5d8",
    inkSoft: "#a99e8d",
    line: "#3a332b",
    field: "#746f6a",
    accent: "#db7b51",
    accentSoft: "#3a2a20",
    draft: "#6fbf95",
    danger: "#e08080",
    ...STOCK_DARK,
    onAccent: "#1a1713",
  },
  walnut: {
    bg: "#1c1410",
    panel: "#261c16",
    panel2: "#33261e",
    ink: "#f0e4d4",
    inkSoft: "#b29a82",
    line: "#463528",
    field: "#7c7066",
    accent: "#c4a574",
    accentSoft: "#3a2e22",
    draft: "#8fbf8a",
    danger: "#d08a7a",
    ...STOCK_DARK,
    onAccent: "#1c1410",
  },
  inkwell: {
    bg: "#121820",
    panel: "#18212c",
    panel2: "#222d3a",
    ink: "#e6e0d4",
    inkSoft: "#9aa3ad",
    line: "#2f3b4a",
    field: "#6d7680",
    accent: "#c9a27a",
    accentSoft: "#2f2a24",
    draft: "#6db8a0",
    danger: "#d48888",
    ...STOCK_DARK,
    onAccent: "#121820",
  },
  candle: {
    bg: "#14110e",
    panel: "#1d1813",
    panel2: "#2a221a",
    ink: "#f3e6cf",
    inkSoft: "#b8a078",
    line: "#3d3226",
    field: "#746c64",
    accent: "#e0a85c",
    accentSoft: "#3a2c18",
    draft: "#9bc47a",
    danger: "#e09078",
    ...STOCK_DARK,
    onAccent: "#14110e",
  },
};

/**
 * The Archive typefaces are embedded at build time by the expo-font plugin in
 * app.json (a new native build, never an OTA update), so they are there on the
 * first frame. A native font is addressed by a different name on each OS: iOS
 * by the file's PostScript name, Android by the file name.
 */
const embedded = (ios: string, android: string) => (Platform.OS === "ios" ? ios : android);

export const fonts = {
  /** The manuscript's own face (the author's editor-font setting). */
  serif: "Georgia",
  sans: "System",
  /** Archive display: Newsreader light, italic for the one emphasised word. */
  display: embedded("Newsreader-Light", "Newsreader_300Light"),
  displayRegular: embedded("Newsreader-Regular", "Newsreader_400Regular"),
  displayItalic: embedded("Newsreader-Italic", "Newsreader_400Regular_Italic"),
  /** Archive UI: Instrument Sans. */
  ui: embedded("InstrumentSans-Regular", "InstrumentSans_400Regular"),
  uiMedium: embedded("InstrumentSans-Medium", "InstrumentSans_500Medium"),
  uiBold: embedded("InstrumentSans-SemiBold", "InstrumentSans_600SemiBold"),
  /** Archive marginalia: JetBrains Mono, small, tracked, usually uppercase. */
  mono: embedded("JetBrainsMono-Regular", "JetBrainsMono_400Regular"),
  monoMedium: embedded("JetBrainsMono-Medium", "JetBrainsMono_500Medium"),
};

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEME_META.some((t) => t.id === value);
}

export function isDarkTheme(id: ThemeId): boolean {
  return THEME_META.find((t) => t.id === id)?.mode === "dark";
}

/** Default (Ciciro) tokens - used by tests and as a fallback. */
export const colors = THEME_PALETTES[DEFAULT_THEME];

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
      fontFamily: fonts.ui,
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
      borderColor: c.field,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontFamily: fonts.ui,
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
      fontFamily: fonts.uiBold,
      fontSize: 16,
    },
    ghostBtn: {
      paddingVertical: 14,
      alignItems: "center",
    },
    ghostBtnText: {
      color: c.accent,
      fontFamily: fonts.uiMedium,
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
      fontFamily: fonts.ui,
      fontSize: 13,
    },
  });
}

export const layout = makeLayout(colors);
