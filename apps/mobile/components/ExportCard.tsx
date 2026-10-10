import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as haptics from "../lib/haptics";
import { DrawCheck, useDrawProgress } from "./DrawCheck";
import { PressableCard } from "./PressableCard";
import { ExportIcon } from "./icons";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import {
  ExportUnavailableError,
  ExportUnsyncedError,
  exportFormatsFor,
  exportManuscript,
  type ExportFormat,
} from "../lib/export";
import { ApiError } from "../lib/api/client";
import type { ManuscriptKind } from "../lib/manuscript-kind";
import type { Chapter } from "../lib/api/types";
import { scriptHtmlSupported } from "../lib/screenplay";
import { htmlWithoutSuggestions } from "../lib/suggestions";
import { AlertText } from "./AlertText";
import { BetaBadge } from "./BetaBadge";
import { ScriptLanguageInfo } from "./ScriptLanguageInfo";

/** How long the finished tick shows before the share sheet opens. */
const EXPORT_READY_MS = 400;

function ReadyTick({ color }: { color: string }) {
  const progress = useDrawProgress(true, 0, { drawOnMount: true });
  return <DrawCheck progress={progress} color={color} size={16} />;
}

/**
 * Export the manuscript as EPUB, PDF or Word through the share sheet. A script
 * also gets its own screenplay PDF and a Fountain file, both Beta; the PDF is
 * grayed out, with an info button, for a script written in a language script
 * formatting does not support yet (its live sequences, as the server exports
 * them, measured by `scriptHtmlSupported`).
 */
export function ExportCard({
  projectId,
  flushEdits,
  kind = "novel",
  chapters = [],
}: {
  projectId: string;
  flushEdits?: () => Promise<boolean>;
  kind?: ManuscriptKind;
  chapters?: readonly Pick<Chapter, "content" | "archivedAt">[];
}) {
  const { t } = useTranslation();
  const screenplay = kind === "screenplay";
  const scriptLanguage = useMemo(
    () =>
      !screenplay ||
      scriptHtmlSupported(chapters.filter((c) => !c.archivedAt).map((c) => htmlWithoutSuggestions(c.content))),
    [screenplay, chapters]
  );
  const { layout, colors } = useAppTheme();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  // The format whose file is ready: its spinner becomes a tick for a beat before the share sheet opens.
  const [ready, setReady] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatLabel = (format: ExportFormat) =>
    screenplay && format === "pdf" ? t("export.screenplayPdf") : t(`export.${format}`);

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
            : // The server refuses a screenplay PDF for a script in a writing system Courier cannot set.
              err instanceof ApiError && err.status === 422
              ? t("screenplay.languageInfo.body")
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
        {busy
          ? t("export.preparing", { format: formatLabel(busy) })
          : screenplay
            ? t("export.screenplayMeta")
            : t("export.meta")}
      </Text>
      <View style={styles.row}>
        {exportFormatsFor(kind).map((format) => {
          const label = formatLabel(format);
          const script = screenplay && (format === "pdf" || format === "fountain");
          // Fountain is plain text in any language; only the PDF's Courier needs one it can set.
          const unavailable = screenplay && format === "pdf" && !scriptLanguage;
          return (
            <PressableCard
              key={format}
              disabled={busy !== null || unavailable}
              onPress={() => void run(format)}
              accessibilityRole="button"
              accessibilityLabel={t("export.a11y", { format: label })}
              accessibilityHint={unavailable ? t("screenplay.languageInfo.body") : undefined}
              accessibilityState={{ disabled: busy !== null || unavailable, busy: busy === format }}
              style={[
                styles.pill,
                // The Beta mark makes a script's pill too wide to share a row: it gets its own.
                script ? styles.pillWide : null,
                {
                  borderColor: unavailable ? colors.inkSoft : colors.ink,
                  backgroundColor: "transparent",
                  opacity: busy && busy !== format ? 0.5 : 1,
                },
              ]}
            >
              {/* A grayed-out pill dims what it says, not its info button. */}
              <View style={[styles.pillContent, unavailable ? { opacity: 0.5 } : null]}>
                {ready === format ? (
                  <ReadyTick color={colors.ink} />
                ) : busy === format ? (
                  <ActivityIndicator size="small" color={colors.ink} accessibilityLabel={t("common.loading")} />
                ) : (
                  <ExportIcon color={colors.ink} size={16} />
                )}
                <Text numberOfLines={1} style={[styles.pillText, styles.pillLabel, { color: colors.ink }]}>{label}</Text>
                {script ? <BetaBadge testID={`export-beta-${format}`} /> : null}
              </View>
              {unavailable ? <ScriptLanguageInfo testID="export-language-info" /> : null}
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
  pillContent: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  pillWide: { flexBasis: "100%" },
  pillText: { fontFamily: fonts.uiBold, fontSize: 15 },
  pillLabel: { flexShrink: 1 },
});
