import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../lib/settings";
import {
  EXPORT_FORMATS,
  ExportUnavailableError,
  ExportUnsyncedError,
  exportManuscript,
  type ExportFormat,
} from "../lib/export";

/** Export the manuscript as EPUB, PDF or Word through the share sheet. */
export function ExportCard({
  projectId,
  flushEdits,
}: {
  projectId: string;
  flushEdits?: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const { layout, colors } = useAppTheme();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(format: ExportFormat) {
    if (busy) return;
    setError(null);
    setBusy(format);
    try {
      await exportManuscript(projectId, format, { flush: flushEdits });
    } catch (err) {
      setError(
        err instanceof ExportUnavailableError
          ? t("export.unavailable")
          : err instanceof ExportUnsyncedError
            ? t("export.unsynced")
            : t("export.error")
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[layout.card, { marginBottom: 16 }]}>
      <Text style={layout.cardTitle}>{t("export.title")}</Text>
      <Text style={layout.cardMeta}>
        {busy ? t("export.preparing", { format: t(`export.${busy}`) }) : t("export.meta")}
      </Text>
      <View style={styles.row}>
        {EXPORT_FORMATS.map((format) => {
          const label = t(`export.${format}`);
          return (
            <Pressable
              key={format}
              disabled={busy !== null}
              onPress={() => void run(format)}
              accessibilityRole="button"
              accessibilityLabel={t("export.a11y", { format: label })}
              accessibilityState={{ disabled: busy !== null, busy: busy === format }}
              style={[
                styles.pill,
                { borderColor: colors.line, backgroundColor: colors.bg, opacity: busy && busy !== format ? 0.5 : 1 },
              ]}
            >
              {busy === format ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={[styles.pillText, { color: colors.accent }]}>{label}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Text style={layout.error} role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginTop: 12 },
  pill: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontSize: 15, fontWeight: "600" },
});
