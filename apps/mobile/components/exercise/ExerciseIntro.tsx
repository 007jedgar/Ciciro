import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { exerciseMinutes, namesParts, type ExerciseDef } from "../../lib/writing-exercise";
import { PressableCard } from "../PressableCard";
import { ExerciseTopBar } from "./ExerciseTopBar";

/**
 * What an exercise is, before the quiet starts: what it is for, its parts and
 * how long each takes, and, when it follows a named writer's practice, whose.
 * An exercise of one part skips the list, since there is nothing to walk through.
 */
export function ExerciseIntro({
  exercise,
  onBegin,
  onClose,
  onBack,
}: {
  exercise: ExerciseDef;
  onBegin: () => void;
  onClose: () => void;
  /** Back to the list, when the person came from it. */
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const insets = useSafeAreaInsets();
  const base = `exercise.items.${exercise.id}`;
  return (
    <View style={{ flex: 1 }}>
      <ExerciseTopBar
        closeLabel={t("exercise.close")}
        onClose={onClose}
        backLabel={onBack ? t("exercise.allExercises") : undefined}
        onBack={onBack}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {t(`${base}.title`)}
        </Text>
        <Text style={[layout.body, { marginTop: 10 }]}>{t(`${base}.tagline`)}</Text>
        <Text style={[layout.body, { marginTop: 10 }]}>{t(`${base}.intro`)}</Text>

        {namesParts(exercise) ? (
          <View style={{ marginTop: 28 }}>
            {exercise.parts.map((part, index) => (
              <View
                key={part.id}
                accessible
                accessibilityLabel={`${t(`${base}.parts.${part.id}.name`)}. ${t(`${base}.parts.${part.id}.blurb`)} ${t("exercise.minutes", { count: part.minutes })}`}
                style={[styles.part, { borderColor: colors.line }]}
              >
                <Text style={[styles.partNumber, { color: colors.accent }]}>{index + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[layout.cardTitle, { fontFamily: fonts.displayRegular, fontSize: 20 }]}>
                    {t(`${base}.parts.${part.id}.name`)}
                  </Text>
                  <Text style={layout.cardMeta}>{t(`${base}.parts.${part.id}.blurb`)}</Text>
                </View>
                <Text style={[styles.partMinutes, { color: colors.inkSoft }]}>
                  {t("exercise.minutes", { count: part.minutes }).toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text style={[layout.cardMeta, { marginTop: 16 }]}>{t("exercise.total", { count: exerciseMinutes(exercise) })}</Text>
        {exercise.credited ? (
          <Text style={[layout.cardMeta, { marginTop: 10, fontStyle: "italic" }]}>{t(`${base}.credit`)}</Text>
        ) : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 8 }}>
        <PressableCard
          accent
          onPress={onBegin}
          accessibilityRole="button"
          accessibilityLabel={t("exercise.begin")}
          style={[layout.primaryBtn, { marginTop: 0 }]}
        >
          <Text style={layout.primaryBtnText}>{t("exercise.begin")}</Text>
        </PressableCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40 },
  part: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  partNumber: { fontFamily: fonts.mono, fontSize: 13, width: 14, marginTop: 6 },
  partMinutes: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, marginTop: 8 },
});
