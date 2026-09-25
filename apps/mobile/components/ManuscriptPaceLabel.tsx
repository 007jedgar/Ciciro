import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ciciro } from "../lib/api/resources";
import { useAppTheme } from "../lib/settings";
import { nanoPreset, manuscriptPace } from "../lib/manuscript-target";
import type { ManuscriptPace } from "../lib/manuscript-target";

type TargetState = {
  wordGoal: number;
  deadline: string;
  manuscriptWords: number;
  pace: ManuscriptPace;
} | null;

export function ManuscriptPaceLabel({
  projectId,
  manuscriptWords,
}: {
  projectId: string;
  manuscriptWords: number;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const [target, setTarget] = useState<TargetState>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ciciro.projects.target.get(projectId).then(
      (data) => {
        if (!cancelled) setTarget(data.target);
      },
      () => {
        if (!cancelled) setTarget(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const pace = useMemo(() => {
    if (!target) return null;
    return manuscriptPace(target, manuscriptWords);
  }, [target, manuscriptWords]);

  async function applyNano() {
    setBusy(true);
    try {
      const preset = nanoPreset();
      const data = await ciciro.projects.target.put(projectId, {
        wordGoal: preset.wordGoal,
        deadline: preset.deadline,
      });
      setTarget(data.target);
    } catch {
      /* keep prior */
    } finally {
      setBusy(false);
    }
  }

  if (!target || !pace) {
    return (
      <Pressable
        onPress={() => void applyNano()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("target.setNano")}
        style={styles.wrap}
      >
        <Text style={[styles.text, { color: colors.accent }]}>{t("target.setNano")}</Text>
      </Pressable>
    );
  }

  const label = pace.complete
    ? t("target.complete")
    : pace.pace == null
      ? t("target.pastDeadline", { count: pace.remaining })
      : t("target.pace", { count: pace.pace, date: target.deadline });

  return (
    <View style={styles.wrap} accessibilityLabel={label}>
      <Text style={[styles.text, { color: colors.inkSoft }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  text: {
    fontSize: 12,
  },
});
