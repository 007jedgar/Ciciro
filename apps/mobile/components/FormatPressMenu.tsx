import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { Glass } from "./Glass";
import { FormatMark, type FormatBlockKind } from "./FormatBar";

export function FormatPressMenu({
  kind = "paragraph",
  onSetKind,
  testID = "format-press",
}: {
  kind?: FormatBlockKind;
  onSetKind: (kind: FormatBlockKind) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const dark = themed?.dark ?? false;

  const blockBtns: { id: FormatBlockKind; label: string; a11y: string }[] = [
    { id: "heading", label: "H", a11y: t("manuscript.formatHeading") },
    { id: "quote", label: "“", a11y: t("manuscript.formatQuote") },
    { id: "list_item", label: "•", a11y: t("manuscript.formatList") },
  ];

  function press(next: FormatBlockKind) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSetKind(next);
  }

  return (
    <Glass dark={dark} colors={colors} radius={14} style={styles.panel}>
      <View
        testID={testID}
        accessibilityRole="menu"
        accessibilityLabel={t("manuscript.formatPress")}
        style={styles.row}
      >
        <Pressable
          accessibilityRole="menuitem"
          accessibilityLabel={t("manuscript.formatParagraph")}
          accessibilityState={{ selected: kind === "paragraph" }}
          onPressIn={() => press("paragraph")}
          style={({ pressed }) => [
            styles.kind,
            {
              backgroundColor: kind === "paragraph" ? colors.accentSoft : "transparent",
              opacity: pressed ? 0.65 : 1,
            },
          ]}
        >
          <Text style={[styles.kindLabel, { color: kind === "paragraph" ? colors.accent : colors.inkSoft }]}>
            {t("manuscript.formatParagraph")}
          </Text>
        </Pressable>
        {blockBtns.map((btn) => (
          <FormatMark
            key={btn.id}
            label={btn.label}
            a11y={btn.a11y}
            active={kind === btn.id}
            compact
            disabled={false}
            colors={colors}
            onPressIn={() => press(kind === btn.id ? "paragraph" : btn.id)}
          />
        ))}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 6, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 2 },
  kind: { paddingHorizontal: 8, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  kindLabel: { fontFamily: fonts.sans, fontSize: 13, fontWeight: "500" },
});
