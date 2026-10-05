import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { EditMode } from "../lib/edit-mode";
import { useAppTheme } from "../lib/settings";
import { Glass } from "./Glass";

const MODES: EditMode[] = ["edits", "chat"];

/**
 * The chat's two-state switch between Allow edits and Chat only. The
 * conversation owns the choice (useCiciroChat); the server enforces it per turn.
 */
export function EditModeToggle({
  mode,
  onChange,
}: {
  mode: EditMode;
  onChange: (mode: EditMode) => void;
}) {
  const { t } = useTranslation();
  const { colors, dark } = useAppTheme();
  return (
    <Glass dark={dark} colors={colors} radius={14}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("ciciroTab.editMode.label")} style={styles.row}>
        {MODES.map((value) => {
          const selected = mode === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={t(`ciciroTab.editMode.${value}`)}
              accessibilityHint={t(`ciciroTab.editMode.${value}Hint`)}
              onPress={() => {
                if (!selected) onChange(value);
              }}
              style={[styles.option, selected && { backgroundColor: colors.accentSoft }]}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: selected ? colors.accent : colors.inkSoft,
                  fontSize: 13,
                  fontWeight: selected ? "600" : "400",
                }}
              >
                {t(`ciciroTab.editMode.${value}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", padding: 3, gap: 2 },
  option: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 11 },
});
