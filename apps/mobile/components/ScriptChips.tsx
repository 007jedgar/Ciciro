import { ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { CUE_EXTENSIONS, type Completion } from "../lib/screenplay";
import { alpha } from "./Glass";
import { ScriptLanguageInfo } from "./ScriptLanguageInfo";
import { SelectChip, SelectLabel } from "./SelectChip";

/**
 * The phone's autocomplete: names, places and times of day for the cue or the
 * scene heading under the caret, as chips just above the element bar, and the
 * extensions (V.O., O.S., CONT'D) of a cue that has a name. A chip is a tap, so
 * the caret stays in the page and the keyboard stays up.
 */
export function ScriptChips({
  choices,
  cue,
  extensionLit,
  extensionsEnabled = true,
  onPick,
  onToggleExtension,
  testID = "script-chips",
}: {
  choices: readonly Completion[];
  /** Whether the line is a cue with a name, so the extensions can be set. */
  cue: boolean;
  /** Which extensions the cue carries now. */
  extensionLit: (extension: string) => boolean;
  /** False in a language script formatting does not cover: the extensions are grayed out. */
  extensionsEnabled?: boolean;
  onPick: (choice: Completion) => void;
  onToggleExtension: (extension: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  if (choices.length === 0 && !cue) return null;
  const tokens = {
    restFill: "transparent",
    activeFill: colors.accent,
    restBorder: colors.line,
    activeBorder: colors.accent,
    restText: colors.ink,
    activeText: colors.bg,
  };
  return (
    <View
      testID={testID}
      accessibilityRole="toolbar"
      accessibilityLabel={t("screenplay.speed.chips")}
      style={[styles.row, { borderTopColor: colors.line, backgroundColor: alpha(colors.bg, 0.92) }]}
    >
      <View style={styles.scroller}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.chips}
        >
          {cue
            ? CUE_EXTENSIONS.map((extension) => {
                const lit = extensionLit(extension);
                return (
                  <SelectChip
                    key={extension}
                    selected={lit}
                    tokens={tokens}
                    accessibilityRole="button"
                    accessibilityLabel={lit ? t("screenplay.speed.extensionOn", { extension }) : extension}
                    accessibilityState={{ selected: lit, disabled: !extensionsEnabled }}
                    disabled={!extensionsEnabled}
                    onPress={() => onToggleExtension(extension)}
                    style={{ opacity: extensionsEnabled ? 1 : 0.4 }}
                    surfaceStyle={styles.chip}
                  >
                    <SelectLabel style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: "600" }}>{extension}</SelectLabel>
                  </SelectChip>
                );
              })
            : null}
          {cue && choices.length > 0 ? <View style={[styles.divider, { backgroundColor: colors.line }]} /> : null}
          {choices.map((choice) => (
            <SelectChip
              key={choice.label}
              selected={false}
              tokens={tokens}
              accessibilityRole="button"
              accessibilityLabel={choice.label}
              onPress={() => onPick(choice)}
              surfaceStyle={styles.chip}
            >
              <SelectLabel style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: "600" }}>{choice.label}</SelectLabel>
            </SelectChip>
          ))}
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={[alpha(colors.bg, 0), colors.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.fade}
        />
      </View>
      {cue && !extensionsEnabled ? <ScriptLanguageInfo testID="script-extensions-info" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingLeft: 12,
    paddingRight: 8,
    minHeight: 44,
  },
  scroller: { flex: 1, alignSelf: "stretch", justifyContent: "center" },
  fade: { position: "absolute", top: 0, bottom: 0, right: 0, width: 28 },
  chips: { alignItems: "center", gap: 6, paddingVertical: 4, paddingRight: 24 },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1, justifyContent: "center" },
  divider: { width: StyleSheet.hairlineWidth, height: 20, marginHorizontal: 2 },
});
