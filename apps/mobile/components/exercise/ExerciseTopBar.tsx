import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { CloseIcon } from "../icons";
import { TapPressable } from "../TapPressable";

/** Height of the row, so a page can reserve it while the bar fades. */
export const EXERCISE_BAR_HEIGHT = 36;

/**
 * The one quiet row above every step of the exercise, like focus mode's exit
 * line: a small tracked label on the left (which part, and where in the three),
 * the part's clock ring if it has one, and a way out.
 */
export function ExerciseTopBar({
  label,
  ring,
  closeLabel,
  onClose,
}: {
  label?: string;
  ring?: ReactNode;
  closeLabel: string;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { paddingTop: insets.top + 14 }]}>
      <Text style={[styles.label, { color: colors.inkSoft }]} accessibilityRole="header" numberOfLines={1}>
        {label ? label.toUpperCase() : ""}
      </Text>
      <View style={styles.right}>
        {ring}
        <TapPressable
          feedback="dim"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          hitSlop={12}
          style={styles.close}
        >
          <CloseIcon color={colors.inkSoft} size={16} />
        </TapPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    minHeight: EXERCISE_BAR_HEIGHT + 14,
  },
  label: { flex: 1, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2 },
  right: { flexDirection: "row", alignItems: "center", gap: 16 },
  close: { padding: 4 },
});
