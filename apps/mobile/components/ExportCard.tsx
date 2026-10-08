import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as haptics from "../lib/haptics";
import { DrawCheck, useDrawProgress } from "./DrawCheck";
import { PressableCard } from "./PressableCard";
import { ExportIcon } from "./icons";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import {
  EXPORT_FORMATS,
  ExportUnavailableError,
  ExportUnsyncedError,
  exportManuscript,
  type ExportFormat,
} from "../lib/export";
import { AlertText } from "./AlertText";

/** How long the finished tick shows before the share sheet opens. */
const EXPORT_READY_MS = 400;

function ReadyTick({ color }: { color: string }) {
  const progress = useDrawProgress(true, 0, { drawOnMount: true });
  return <DrawCheck progress={progress} color={color} size={16} />;
}

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
  // The format whose file is ready: its spinner becomes a tick for a beat before the share sheet opens.
  const [ready, setReady] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(format: ExportFormat) {
    if (busy) return;
    setError(null);
    setBusy(format);
    try {
      await exportManuscript(projectId, format, {
        flush: flushEdits,
        beforeShare: async () => {
          setReady(format);
          haptics.success();
          await new Promise((resolve) => setTimeout(resolve, EXPORT_READY_MS));
        },
      });
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
      setReady(null);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.panel, borderColor: colors.line }]}>
      <Text style={[styles.title, { color: colors.ink }]}>{t("export.title")}</Text>
      <Text style={[styles.meta, { color: colors.inkSoft }]}>
        {busy ? t("export.preparing", { format: t(`export.${busy}`) }) : t("export.meta")}
      </Text>
      <View style={styles.row}>
        {EXPORT_FORMATS.map((format) => {
          const label = t(`export.${format}`);
          return (
            <PressableCard
              key={format}
              disabled={busy !== null}
              onPress={() => void run(format)}
              accessibilityRole="button"
              accessibilityLabel={t("export.a11y", { format: label })}
              accessibilityState={{ disabled: busy !== null, busy: busy === format }}
              style={[
                styles.pill,
                { borderColor: colors.ink, backgroundColor: "transparent", opacity: busy && busy !== format ? 0.5 : 1 },
              ]}
            >
              {ready === format ? (
                <ReadyTick color={colors.ink} />
              ) : busy === format ? (
                <ActivityIndicator size="small" color={colors.ink} accessibilityLabel={t("common.loading")} />
              ) : (
                <ExportIcon color={colors.ink} size={16} />
              )}
              <Text numberOfLines={1} style={[styles.pillText, { color: colors.ink }]}>{label}</Text>
            </PressableCard>
          );
        })}
      </View>
      {error ? (
        <AlertText style={layout.error} role="alert">
          {error}
        </AlertText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: 18, marginBottom: 16 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 27, letterSpacing: -0.3 },
  meta: { marginTop: 6, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  pill: {
    flexGrow: 1,
    flexBasis: "40%",
    paddingHorizontal: 12,
    minHeight: 42,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontFamily: fonts.uiBold, fontSize: 15 },
});
