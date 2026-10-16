import { useRef } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AlertText } from "../AlertText";
import { CheckIcon } from "../icons";
import { Kicker } from "../Kicker";
import { SelectCheck, SelectChip, SelectLabel, segmentSelectTokens, type SelectTokens } from "../SelectChip";
import { TapPressable } from "../TapPressable";
import type { BibleEntry } from "../../lib/api/types";
import { bibleFileLabel } from "../../lib/bible-files";
import { applyRequest, appendableFiles, type ScanDestinationChoice } from "../../lib/notes-scan";
import { useAppTheme } from "../../lib/settings";
import { fonts, type ColorTokens } from "../../lib/theme";

function rowTokens(colors: ColorTokens): SelectTokens {
  return {
    restFill: colors.panel,
    activeFill: colors.accentSoft,
    restBorder: colors.line,
    activeBorder: colors.accent,
    restText: colors.ink,
    activeText: colors.ink,
  };
}

/**
 * Step three: where the checked text goes. The story bible takes it as a
 * dated section at the end of a file the writer picks, or as a new character /
 * plot-line entry; the canvas takes each line as a card. Whatever the notes
 * looked like is only the starting choice.
 */
export function DestinationPage({
  choice,
  suggested,
  files,
  text,
  pending,
  error,
  onChoose,
  onAdd,
  onBack,
}: {
  choice: ScanDestinationChoice | null;
  suggested: boolean;
  files: readonly BibleEntry[];
  text: string;
  pending: boolean;
  error: string | null;
  onChoose: (choice: ScanDestinationChoice | null) => void;
  onAdd: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { colors, layout, settings } = useAppTheme();
  const lastBible = useRef<ScanDestinationChoice | null>(null);
  const canvas = choice?.kind === "canvas";
  if (choice && choice.kind !== "canvas") lastBible.current = choice;

  const ready = applyRequest(choice, text) !== null && !pending;
  const entries = appendableFiles(files);
  const newEntry = choice?.kind === "bible-new" ? choice.entry : null;

  function rowStyle(selected: boolean) {
    return [styles.row, { borderColor: selected ? colors.accent : colors.line }];
  }

  return (
    <View testID="scan-destination">
      <Text style={[layout.cardTitle, styles.heading]}>{t("scanNotes.destination.title")}</Text>

      <View style={[styles.segment, { backgroundColor: colors.panel2 }]}>
        {(["bible", "canvas"] as const).map((value) => {
          const active = value === "canvas" ? canvas : !canvas;
          return (
            <SelectChip
              key={value}
              testID={`scan-dest-${value}`}
              selected={active}
              tokens={segmentSelectTokens(colors)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChoose(value === "canvas" ? { kind: "canvas" } : lastBible.current)}
              style={{ flex: 1 }}
              surfaceStyle={styles.segmentBtn}
            >
              <SelectLabel style={styles.segmentText}>{t(`scanNotes.destination.${value}`)}</SelectLabel>
            </SelectChip>
          );
        })}
      </View>

      <Text style={[styles.hint, { color: colors.inkSoft }]}>
        {t(canvas ? "scanNotes.destination.canvasHint" : "scanNotes.destination.bibleHint")}
      </Text>
      {suggested ? (
        <Text testID="scan-suggested" style={[styles.hint, { color: colors.inkSoft, marginTop: 6 }]}>
          {t("scanNotes.destination.suggested")}
        </Text>
      ) : null}

      {canvas ? null : (
        <View style={{ marginTop: 18 }}>
          <Kicker label={t("scanNotes.destination.existing")} count={`${entries.length}`} />
          <View style={styles.list}>
            {entries.map((file) => {
              const selected = choice?.kind === "bible-file" && choice.path === file.path;
              return (
                <SelectChip
                  key={file.path}
                  testID={`scan-file-${file.path}`}
                  selected={selected}
                  tokens={rowTokens(colors)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${bibleFileLabel(file.path)}. ${file.summary}`}
                  accessibilityState={{ selected }}
                  onPress={() => onChoose({ kind: "bible-file", path: file.path })}
                  surfaceStyle={rowStyle(selected)}
                >
                  <View style={styles.rowText}>
                    <SelectLabel style={styles.rowTitle}>{bibleFileLabel(file.path)}</SelectLabel>
                    {file.summary.trim().toLowerCase() === bibleFileLabel(file.path).toLowerCase() ? null : (
                      <Text numberOfLines={1} style={[styles.rowMeta, { color: colors.inkSoft }]}>
                        {file.summary}
                      </Text>
                    )}
                  </View>
                  <SelectCheck>
                    <CheckIcon color={colors.accent} size={18} />
                  </SelectCheck>
                </SelectChip>
              );
            })}
          </View>

          <View style={{ marginTop: 18 }}>
            <Kicker label={t("scanNotes.destination.newEntry")} />
          </View>
          <View style={styles.list}>
            {(["character", "plot"] as const).map((entry) => {
              const selected = newEntry === entry;
              return (
                <View key={entry}>
                  <SelectChip
                    testID={`scan-new-${entry}`}
                    selected={selected}
                    tokens={rowTokens(colors)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() =>
                      onChoose({
                        kind: "bible-new",
                        entry,
                        name: choice?.kind === "bible-new" ? choice.name : "",
                      })
                    }
                    surfaceStyle={rowStyle(selected)}
                  >
                    <View style={styles.rowText}>
                      <SelectLabel style={styles.rowTitle}>
                        {t(entry === "character" ? "scanNotes.destination.newCharacter" : "scanNotes.destination.newPlot")}
                      </SelectLabel>
                    </View>
                    <SelectCheck>
                      <CheckIcon color={colors.accent} size={18} />
                    </SelectCheck>
                  </SelectChip>
                  {selected && choice?.kind === "bible-new" ? (
                    <View style={{ marginTop: 8 }}>
                      <TextInput
                        testID="scan-new-name"
                        style={[layout.input, { marginBottom: 6 }]}
                        value={choice.name}
                        onChangeText={(name) => onChoose({ ...choice, name })}
                        placeholder={t("scanNotes.destination.namePlaceholder")}
                        placeholderTextColor={colors.inkSoft}
                        accessibilityLabel={t(
                          entry === "character" ? "scanNotes.destination.newCharacter" : "scanNotes.destination.newPlot"
                        )}
                        autoCapitalize="words"
                        autoCorrect={settings.autoCorrect}
                        returnKeyType="done"
                        maxLength={80}
                      />
                      <Text style={[styles.rowMeta, { color: colors.inkSoft }]}>{t("scanNotes.destination.newNameHint")}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {error ? (
        <AlertText style={[layout.error, { marginTop: 16 }]} role="alert">
          {error}
        </AlertText>
      ) : null}

      <TapPressable
        testID="scan-add"
        style={[layout.primaryBtn, { marginTop: 20, opacity: ready ? 1 : 0.5 }]}
        disabled={!ready}
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready, busy: pending }}
      >
        <Text style={layout.primaryBtnText}>
          {pending
            ? t("scanNotes.destination.adding")
            : t(canvas ? "scanNotes.destination.addCanvas" : "scanNotes.destination.addBible")}
        </Text>
      </TapPressable>
      <TapPressable
        testID="scan-back-to-text"
        style={layout.ghostBtn}
        onPress={onBack}
        disabled={pending}
        accessibilityRole="button"
        feedback="dim"
      >
        <Text style={layout.ghostBtnText}>{t("scanNotes.destination.back")}</Text>
      </TapPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, marginBottom: 14 },
  segment: { flexDirection: "row", borderRadius: 8, padding: 3 },
  segmentBtn: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9, alignItems: "center" },
  segmentText: { fontFamily: fonts.uiBold, fontSize: 14 },
  hint: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, marginTop: 12 },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.uiBold, fontSize: 15.5 },
  rowMeta: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
});
