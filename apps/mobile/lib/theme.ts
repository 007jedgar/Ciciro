import { StyleSheet } from "react-native";

/** Parchment-adjacent tokens from the web app. */
export const colors = {
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
};

export const fonts = {
  serif: "Georgia",
  sans: "System",
};

export const layout = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  padded: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: colors.ink,
    marginBottom: 8,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.inkSoft,
  },
  error: {
    color: colors.danger,
    marginTop: 8,
    fontSize: 14,
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    color: colors.panel,
    fontSize: 16,
    fontWeight: "600",
  },
  ghostBtn: {
    paddingVertical: 14,
    alignItems: "center",
  },
  ghostBtnText: {
    color: colors.accent,
    fontSize: 16,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.ink,
  },
  cardMeta: {
    marginTop: 4,
    color: colors.inkSoft,
    fontSize: 13,
  },
});
