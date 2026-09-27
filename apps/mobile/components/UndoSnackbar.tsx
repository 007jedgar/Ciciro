import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors } from "../lib/theme";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { Snackbar } from "./Snackbar";

/** "Deleted, Undo" docked at the bottom of a screen while a removal is waiting to commit. */
export function UndoSnackbar({
  message,
  onUndo,
  bottom = 24,
}: {
  message: string | null;
  onUndo: () => void;
  /** Distance from the screen bottom, to clear a floating tab bar. */
  bottom?: number;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const dark = themed?.dark ?? false;
  const reduceMotion = useReduceMotion();
  if (!message) return null;
  return (
    <View pointerEvents="box-none" style={[styles.dock, { bottom }]}>
      <Snackbar
        message={message}
        actionLabel={t("common.undo")}
        onAction={onUndo}
        colors={colors}
        dark={dark}
        reduceMotion={reduceMotion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, zIndex: 20 },
});
