import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import {
  autoAcceptProgress,
  GRAMMAR_AUTO_ACCEPT_MS,
} from "../lib/grammar";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { Glass, alpha } from "./Glass";

function clip(value: string, max = 48): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function GrammarPopup({
  original,
  replacement,
  shownAt,
  durationMs = GRAMMAR_AUTO_ACCEPT_MS,
  reduceMotion = false,
  onAccept,
  onIgnore,
  now = Date.now,
}: {
  original: string;
  replacement: string;
  shownAt: number;
  durationMs?: number;
  reduceMotion?: boolean;
  onAccept: () => void;
  onIgnore: () => void;
  now?: () => number;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const dark = themed?.dark ?? false;
  const [progress, setProgress] = useState(() => autoAcceptProgress(shownAt, durationMs, now()));

  useEffect(() => {
    const tick = () => setProgress(autoAcceptProgress(shownAt, durationMs, now()));
    tick();
    const id = setInterval(tick, reduceMotion ? 250 : 50);
    return () => clearInterval(id);
  }, [shownAt, durationMs, reduceMotion, now]);

  function choose(action: () => void) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    action();
  }

  const seconds = Math.max(0, Math.ceil((1 - progress) * (durationMs / 1000)));

  return (
    <Glass dark={dark} colors={colors} radius={20} style={styles.panel}>
      <View
        testID="grammar-popup"
        accessibilityRole="summary"
        accessibilityLabel={t("manuscript.grammarA11y", {
          original: clip(original),
          replacement: clip(replacement),
        })}
        style={styles.body}
      >
        <View
          testID="grammar-auto-accept"
          accessibilityRole="progressbar"
          accessibilityLabel={t("manuscript.grammarAutoAcceptA11y", { seconds })}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          style={[styles.track, { backgroundColor: alpha(colors.line, dark ? 0.5 : 0.35) }]}
        >
          <View
            style={[
              styles.fill,
              {
                width: `${progress * 100}%`,
                backgroundColor: colors.accent,
              },
            ]}
          />
        </View>
        <Text style={[styles.sample, { color: colors.inkSoft }]} numberOfLines={2}>
          <Text style={styles.original}>{clip(original)}</Text>
          {"  →  "}
          <Text style={[styles.replacement, { color: colors.accent }]}>{clip(replacement)}</Text>
        </Text>
        <View style={styles.actions}>
          <Pressable
            testID="grammar-ignore"
            accessibilityRole="button"
            accessibilityLabel={t("manuscript.grammarIgnore")}
            onPress={() => choose(onIgnore)}
            style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.btnLabel, { color: colors.inkSoft }]}>
              {t("manuscript.grammarIgnore")}
            </Text>
          </Pressable>
          <Pressable
            testID="grammar-accept"
            accessibilityRole="button"
            accessibilityLabel={t("manuscript.grammarAccept")}
            onPress={() => choose(onAccept)}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: alpha(colors.accent, dark ? 0.28 : 0.16), opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.btnLabel, styles.acceptLabel, { color: colors.accent }]}>
              {t("manuscript.grammarAccept")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 14, paddingVertical: 12, maxWidth: 320 },
  body: { gap: 10 },
  track: { height: 4, borderRadius: 999, overflow: "hidden" },
  fill: { height: 4, borderRadius: 999 },
  sample: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 22 },
  original: { textDecorationLine: "line-through" },
  replacement: { fontWeight: "600" },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
  btn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12 },
  btnLabel: { fontSize: 15, fontWeight: "500" },
  acceptLabel: { fontWeight: "600" },
});
