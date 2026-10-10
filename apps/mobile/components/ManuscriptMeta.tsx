import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { manuscriptMetaParts } from "../lib/manuscript-count";
import { useAppTheme } from "../lib/settings";

/** A manuscript row's meta line: a kind chip (journal, screenplay, blog), then genre, count in the kind's unit and, for a script, its pages. */
export function ManuscriptMeta({
  project,
}: {
  project: { kind?: string | null; genre?: string | null; pages?: number; _count?: { chapters: number } };
}) {
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const { kindLabel, text } = manuscriptMetaParts(project, t);
  return (
    <View style={styles.row}>
      {kindLabel ? (
        <View testID="kind-chip" style={[styles.chip, { backgroundColor: colors.accentSoft }]}>
          <Text style={[styles.chipText, { color: colors.accent }]} numberOfLines={1}>
            {kindLabel}
          </Text>
        </View>
      ) : null}
      {text ? <Text style={[layout.cardMeta, styles.text]}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 12, fontWeight: "600" },
  text: { flexShrink: 1 },
});
