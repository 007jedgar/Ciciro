import { StyleSheet, Text, View } from "react-native";
import { CheckIcon } from "../icons";
import { ThemeCardFlightFace } from "../ThemeCard";
import { mixColors } from "../../lib/color";
import type { CarryLook } from "../../lib/onboarding-shell";
import { useAppTheme } from "../../lib/settings";
import { fonts, THEME_PALETTES, type ThemeId } from "../../lib/theme";

/**
 * What the floating copy of each kind of onboarding card starts out as - the
 * card's own surface and title, plus the rest of its face - for the carry (see
 * `useCarry`). Kept next to each other, and built from the same tokens as the
 * cards, so a change to a card has one obvious place to follow it.
 */
export function useCarryLooks() {
  const { colors, layout } = useAppTheme();
  const cardTitle = StyleSheet.flatten(layout.cardTitle);
  const titleStyle = (text: string, color: string) => ({
    text,
    color,
    fontFamily: cardTitle.fontFamily,
    fontSize: Number(cardTitle.fontSize ?? 18),
  });

  return {
    /** A `layout.card` with a title and a line under it: the goal question's options. */
    card(title: string, description: string): CarryLook {
      return {
        background: colors.panel,
        border: colors.line,
        borderWidth: 1,
        radius: 10,
        title: titleStyle(title, colors.ink),
        rest: (
          <View style={styles.cardRest}>
            <Text style={[layout.cardTitle, styles.hidden]}>{title}</Text>
            <Text style={layout.cardMeta}>{description}</Text>
          </View>
        ),
      };
    },

    /** A ticked `ChoiceCard`: the accent tint, and the filled check at its end. */
    choice(title: string, description: string): CarryLook {
      return {
        background: mixColors(colors.panel, colors.accent, 0.1),
        border: mixColors(colors.panel, colors.accent, 0.1),
        borderWidth: 0,
        radius: 10,
        title: titleStyle(title, colors.ink),
        rest: (
          <View style={[styles.cardRest, styles.choiceRow]}>
            <View style={{ flex: 1 }}>
              <Text style={[layout.cardTitle, styles.hidden]}>{title}</Text>
              <Text style={layout.cardMeta}>{description}</Text>
            </View>
            <View style={[styles.box, { backgroundColor: colors.accent }]}>
              <CheckIcon color={colors.onAccent} size={13} />
            </View>
          </View>
        ),
      };
    },

    /** The selected `ThemeCard`: a page painted in its own colours. */
    theme(theme: ThemeId, name: string): CarryLook {
      const palette = THEME_PALETTES[theme];
      return {
        background: palette.bg,
        border: palette.line,
        borderWidth: StyleSheet.hairlineWidth,
        radius: 16,
        title: { text: name, color: palette.ink, fontFamily: fonts.uiBold, fontSize: 14 },
        rest: <ThemeCardFlightFace theme={theme} />,
      };
    },

    /** The accent button: a filled bar with its label. */
    button(label: string): CarryLook {
      const btn = StyleSheet.flatten(layout.primaryBtnText);
      return {
        background: colors.accent,
        border: colors.accent,
        borderWidth: 0,
        radius: 8,
        title: { text: label, color: String(btn.color ?? colors.panel), fontFamily: btn.fontFamily, fontSize: Number(btn.fontSize ?? 16) },
      };
    },
  };
}

const styles = StyleSheet.create({
  cardRest: { padding: 16 },
  choiceRow: { flexDirection: "row", alignItems: "center", gap: 12, height: "100%" },
  hidden: { opacity: 0 },
  box: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
