import { StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import type { BlockMark, BlockMarks } from "../lib/block-editor";
import { emptyBlockMarks } from "../lib/block-editor";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors } from "../lib/theme";
import { Glass } from "./Glass";
import { FormatMark } from "./FormatBar";

export function FormatBubble({
  marks = emptyBlockMarks(),
  onToggleMark,
  testID = "format-bubble",
}: {
  marks?: BlockMarks;
  onToggleMark: (mark: BlockMark) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const dark = themed?.dark ?? false;

  const markBtns: { id: BlockMark; label: string; a11y: string }[] = [
    { id: "bold", label: "B", a11y: t("manuscript.formatBold") },
    { id: "italic", label: "I", a11y: t("manuscript.formatItalic") },
    { id: "underline", label: "U", a11y: t("manuscript.formatUnderline") },
    { id: "strike", label: "S", a11y: t("manuscript.formatStrike") },
  ];

  function press(mark: BlockMark) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onToggleMark(mark);
  }

  return (
    <Glass dark={dark} colors={colors} radius={14} style={styles.panel}>
      <View
        testID={testID}
        accessibilityRole="toolbar"
        accessibilityLabel={t("manuscript.formatSelection")}
        style={styles.row}
      >
        {markBtns.map((btn) => (
          <FormatMark
            key={btn.id}
            label={btn.label}
            a11y={btn.a11y}
            active={marks[btn.id]}
            italic={btn.id === "italic"}
            strike={btn.id === "strike"}
            underline={btn.id === "underline"}
            compact
            disabled={false}
            colors={colors}
            onPressIn={() => press(btn.id)}
          />
        ))}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 6, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 2 },
});
